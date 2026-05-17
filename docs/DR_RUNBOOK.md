# Disaster Recovery Runbook

**Document owner:** Luis Delgado (Altura Apps)
**Last reviewed:** May 16, 2026
**Review cadence:** Quarterly + after any incident
**Scope:** CIA Feeds production (`www.ciafeed.com`)

---

## 1. Architecture at a glance

| Layer | Provider | Region | Single point of failure? |
|---|---|---|---|
| DNS | GoDaddy (registrar) → Vercel DNS for wildcard `*.ciafeed.com` | Global | GoDaddy outage = no DNS |
| Edge / app runtime | Vercel | Global edge, lambdas in `iad1` (us-east-1) | Vercel-wide outage |
| Database | Supabase Postgres 17.6 (`tnqrqimwfhiwjthahwbu`) | `us-east-1` | Single region |
| Object storage | Supabase Storage (same project) | `us-east-1` | Same as DB |
| Auth | NextAuth in-app (JWT, stored in DB) | n/a | Tied to DB availability |
| Email | Resend | n/a | Email outage only; not user-blocking |
| Background jobs | Vercel Cron + in-app queue (Meta delivery) | n/a | Tied to Vercel + DB |
| Third-party APIs | Meta Graph, Stripe, OpenAI, Gemini, Firecrawl, Google Maps, Twilio | Various | All circuit-breakered (`lib/circuitBreaker.ts`) |

**Recovery targets:**
- **RTO** (recovery time objective): 4 hours for full service restoration after a regional Supabase outage; 1 hour for app-layer issues.
- **RPO** (recovery point objective): 24 hours (Supabase Pro daily backups). Point-in-time recovery available within retention window.

---

## 2. Decision tree — what failed?

```
Is www.ciafeed.com returning anything at all?
├── No (DNS / cert errors)         → §3 DNS / domain failure
├── Yes, but 502/503/timeout       → §4 Vercel or runtime failure
├── Yes, but 500 with DB errors    → §5 Supabase outage
├── Yes, normal pages 200 but
│   some features broken           → §6 Third-party API degradation
└── Yes, normal — but slow         → §7 Performance / capacity
```

---

## 3. DNS / domain failure

**Symptoms:** `nslookup www.ciafeed.com` fails. Browsers show NXDOMAIN or cert errors.

**Steps:**
1. Check [GoDaddy status](https://status.godaddy.com/) and the registrar dashboard.
2. Confirm Vercel DNS nameservers are still authoritative for the apex (the wildcard `*` CNAME points to `574ccf76a4bd4aa3.vercel-dns-017.com` at GoDaddy).
3. If the registrar lock or nameservers were changed unexpectedly → §8 (suspected compromise).
4. If GoDaddy is degraded → no remediation possible from our side; communicate to dealers via Slack / direct email (Resend still works because it's not in GoDaddy's path).

**Recovery via failover registrar:** Not currently configured. To set up: transfer apex to Cloudflare DNS with the same wildcard CNAME; minimum 60 minutes TTL convergence.

---

## 4. Vercel or runtime failure

**Symptoms:** Pages return 502, 503, or hang; Vercel dashboard shows failed deploys or "Internal Server Error" events.

**Steps:**
1. Check [Vercel status](https://www.vercel-status.com/).
2. Look at the latest deployment: `npx vercel --token $VERCEL_TOKEN ls cia-feeds-app --scope team_8YDkWKTG7cgBL3nVVzjn1B07`.
3. If the latest deploy is `● Error`, **roll back immediately:**
   ```
   npx vercel --token $VERCEL_TOKEN rollback <previous-ready-url> --scope team_8YDkWKTG7cgBL3nVVzjn1B07
   ```
   or via the Vercel UI: Deployments → previous Ready → "Promote to Production".
4. If the latest deploy is `● Ready` but production is broken, check runtime logs:
   ```
   npx vercel --token $VERCEL_TOKEN logs <production-url> --scope team_8YDkWKTG7cgBL3nVVzjn1B07
   ```
5. **Common runtime causes:**
   - Missing env var → check `npx vercel --token $VERCEL_TOKEN env ls production`
   - Database connection exhaustion → see §5
   - Bad migration → see §5 (rollback migration)

**Recovery via re-deploy:** Force a fresh deploy from `main` by pushing an empty commit:
```
git commit --allow-empty -m "force redeploy"
git push origin main
```

---

## 5. Supabase / database outage

**Symptoms:** App returns 500 or 503 with `database_unavailable`; Postgres logs show `connection refused`, `server closed the connection`, or `database is starting up`.

**Steps:**

1. **Check Supabase status:** [status.supabase.com](https://status.supabase.com/). Confirm whether `us-east-1` is degraded.

2. **Determine impact:** Public storefront and feed routes have ISR + retry (`lib/dbResilience.ts`) — they serve stale cached HTML for up to 60s and return clean 503s with `Retry-After: 30` after that. Dashboard / admin / write paths are fully broken during DB outage.

3. **If Supabase is up but our project is down:**
   - Open the [Supabase project dashboard](https://supabase.com/dashboard/project/tnqrqimwfhiwjthahwbu).
   - Check Compute → if the database was paused, click "Restore project".
   - Check Pooler / Database settings; confirm `DATABASE_URL` and `DIRECT_URL` match the values in Vercel env (`npx vercel env ls production`).

4. **Connection pool exhaustion:**
   - Symptom: P2024 errors. We use PgBouncer transaction pooling; rare but possible during traffic spikes.
   - Mitigation: temporarily reduce concurrent Vercel functions via Vercel project settings or pause the Meta delivery cron (`/api/cron/dispatch-meta-delivery`) which is the heaviest writer.

5. **Bad migration in production:**
   - Symptom: build fails on `prisma migrate deploy` step.
   - Rollback path: revert the offending commit on `main` and write a compensating migration. **Never** edit a migration that's already been applied — write a new one that reverses it.
   - Reference: `prisma/migrations/20260515200000_reconcile_missing_schema/migration.sql` is the canonical example of an idempotent recovery migration.

6. **Full regional outage (us-east-1 down for hours):**
   - Authoritative data lives only in `us-east-1` today. There is no warm standby.
   - Best available recovery: restore the most recent Supabase backup to a new project in a different region. Supabase Pro daily backups can be restored from the project dashboard → Database → Backups.
   - During restore (~30-60 min), update `DATABASE_URL` and `DIRECT_URL` in Vercel env to point to the new project; redeploy.
   - **Data loss:** up to 24 hours since last daily backup. Use point-in-time recovery (PITR) if enabled and within retention window.

7. **PITR check:** Confirm PITR is enabled in Supabase project settings → Database → Point-in-Time Recovery. Retention depends on plan tier; verify on quarterly review.

---

## 6. Third-party API degradation

**Symptoms:** Specific features broken, app otherwise normal.

All external clients are wrapped in `lib/circuitBreaker.ts` and will return graceful 503s with `retry: true` after 5 consecutive failures, fail-fast for 30 seconds, then re-test. No remediation is needed for short blips — the breaker self-heals.

For prolonged outages, check `inspectBreaker(name)` via the future `/api/admin/health` endpoint (TBD) or rely on the `circuit_breaker_opened` log events surfaced in Vercel logs.

| Dependency | Affected features | Fallback |
|---|---|---|
| Meta Graph API | Meta catalog delivery, retargeting audiences, CAPI events | Dealers still get CSV feed (`/feeds/<slug>`); no user-visible breakage for the storefront. Retargeting audiences stop updating until Meta recovers; existing audiences continue to function on Meta's side. |
| Twilio | Inbound SMS responses, outbound SMS replies | SMS conversations log inbound messages to DB but outbound replies fail. Dashboard click-to-SMS still works (uses native `sms:` URI, no Twilio involvement). |
| Stripe | Billing / subscription updates | Read-only on existing subscriptions; auto-downgrade on payment failure still works (handled by Stripe directly) |
| Resend | Email notifications | Sends are best-effort; circuit-breakered (`lib/email.ts`). No user-visible failure |
| OpenAI | Voice-agent transcription | Returns 503 to widget; user can re-try later |
| Gemini | Voice-agent generation, image spotlight | Returns 503; user can re-try later |
| Firecrawl | Listing scrape from URL | Returns scrape failure; user can re-submit or upload manually |
| Google Maps | Address geocoding | Address saves succeed without geocoding; storefront still works (no map render until geocoding succeeds) |

---

## 7. Performance / capacity

**Symptoms:** Pages slow, no clear errors.

1. **Check Vercel function metrics:** Analytics → Functions tab. Look for cold-start spikes or high p95 duration.
2. **Check Supabase metrics:** Project → Reports → CPU, IO, Connections.
3. **Common causes:**
   - Meta delivery job storm (one dealer's catalog reset triggers thousands of writes).
   - Missing index on a heavy query (rare since indices were added).
   - Cron cadence too aggressive.
4. **Mitigations:**
   - Pause non-critical crons via Vercel UI: `/api/cron/url-health` and `/api/cron/refresh-meta-tokens` can sleep an hour without breaking anything user-facing.
   - Scale up Supabase compute (Project → Settings → Compute) — takes minutes, billed hourly.

---

## 8. Suspected compromise

See `docs/EMPLOYEE_ACCESS_POLICY.md` §7. Short version: rotate every secret in `npx vercel env ls production`, force-redeploy, audit logs for the prior 30 days.

---

## 9. Communications

Even when fixes are fast, communicate so dealers aren't blindsided:

1. **In-app banner:** TBD — add `app/_components/IncidentBanner.tsx` and wire to a `ServiceStatus` table. For now, post to a shared dealer Slack channel if one exists.
2. **Email broadcast:** Use Resend (`lib/email.ts:sendEmail`) with the admin email list pulled from `Dealer.email` for active subscriptions.
3. **Status page:** Not yet hosted. Future: post to a Vercel-hosted `status.ciafeed.com` static site that doesn't share infra with the main app.
4. **Post-mortem:** Within 5 business days of any user-visible incident, write a post-mortem in `docs/INCIDENTS.md`: what happened, timeline, root cause, what we changed.

---

## 10. Drill cadence

- **Monthly:** Restore the latest Supabase backup to a scratch project and confirm the data is intact. Document in `docs/DR_DRILL_LOG.md`.
- **Quarterly:** Full failover dry run — spin up a new Supabase project in a different region from a backup, point a staging deployment at it, verify storefront + feeds render. Document any RTO/RPO drift.
- **After any incident:** Re-run section 2's decision tree from memory and confirm the runbook would have led you to the correct branch.
