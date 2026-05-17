# Employee Access Policy

**Document owner:** Luis Delgado (Altura Apps)
**Last reviewed:** May 16, 2026
**Review cadence:** Quarterly (next: August 2026)
**Scope:** All systems holding CIA Feeds production data — Vercel, Supabase, GitHub (`Altura-Apps/cia-feeds-app`), Stripe, Resend, Meta Business, Google Maps / Gemini, OpenAI, Firecrawl.

---

## 1. Principles

1. **Least privilege.** Every account starts with the minimum role required to do the work, and is upgraded only when a specific task requires it.
2. **Named accounts only.** No shared logins. Each person uses their own email / SSO identity. Shared dashboards/passwords are explicitly disallowed.
3. **MFA mandatory.** Every production-affecting account must have multi-factor authentication enabled at the provider (TOTP or hardware key preferred over SMS).
4. **Audit trail.** Privileged actions are logged. We rely on the `AdminAuditLog` table inside the app and provider-side logs (Vercel audit log, Supabase activity, GitHub Audit Log) for everything else.
5. **Default-deny on departure.** When someone leaves, all access is revoked the same day, and any secrets they may have known are rotated.

---

## 2. Roles

| Role | Description | Examples |
|---|---|---|
| **Owner** | Holds billing, root access, can grant/revoke roles. | Luis Delgado |
| **Engineer** | Full read/write access to source code; deploy to preview; production deploys via Vercel git integration only. | Future hires |
| **Operator** | Admin panel access to support real dealers (read mostly; write only on approved fields like billing overrides). | Future support staff |
| **Read-only auditor** | Audit-log read access. No write. | External SOC-2 / pen test vendor |
| **Vendor / contractor** | Time-bounded, single-purpose access; expires automatically. | Pen tester, accountant |

---

## 3. Service-by-service matrix

| Service | Owner accounts | Engineer | Operator | Auditor | Vendor / contractor | MFA enforced |
|---|---|---|---|---|---|---|
| **Vercel** (`info-87491789's projects`, team `team_8YDkWKTG7cgBL3nVVzjn1B07`) | Yes | Yes (deployer) | No | Read-only (Vercel Audit Log) | Time-boxed | Yes (Vercel SSO + TOTP) |
| **Supabase** (`tnqrqimwfhiwjthahwbu`, org `jxvaegszjlitkmrqchkd`) | Yes | Yes (developer) | Read-only via app admin | Read-only (Supabase activity log) | Time-boxed | Yes |
| **GitHub** (`Altura-Apps/cia-feeds-app`) | Yes (org owner) | Write (no force-push to main) | No | Read | Read on specific PR | Yes (org-enforced) |
| **Stripe** | Yes | Read-only Test mode | Refunds + customer lookup in Live | Read-only Live (Reports + Logs) | No | Yes |
| **Resend** | Yes | Yes | No | No | No | Yes |
| **Meta Business** | Yes | Developer role | No | No | No | Yes (Meta-enforced) |
| **Google Cloud (Maps, Gemini)** | Yes | Editor on relevant projects | No | Viewer | No | Yes |
| **OpenAI** | Yes | Member | No | No | No | Yes |
| **Firecrawl** | Yes | Member | No | No | No | Yes |
| **GoDaddy** (`ciafeed.com` registrar) | Yes | No | No | No | No | Yes |
| **Twilio** (SMS agent, number ending 8129) | Yes | Member | No | No | No | Yes (Twilio-enforced for SID/token holders) |

---

## 4. Granting access (onboarding)

When granting access to a new person:

1. **Verify identity.** Request access by email from the person's verified work address.
2. **Define scope and end date.** Even permanent roles get a 90-day initial expiry that must be explicitly renewed.
3. **Provision minimum role.** Default to `Operator` for non-engineers, `Engineer` for engineers. Never start as Owner.
4. **Send credentials securely.** Use the service's native invite flow (never email passwords). Require MFA enrollment on first login.
5. **Document.** Add a row to `docs/ACCESS_REGISTER.md` (create on first need) with: name, email, role, services, granted-by, granted-on, expires-on.
6. **Verify MFA enrolled.** Within 7 days, confirm the new account shows MFA active in each provider's admin panel.

---

## 5. Revoking access (offboarding)

When someone leaves or changes role:

1. **Same-day revocation.** Remove from every service in section 3 the day the relationship ends.
2. **Rotate shared-knowledge secrets.** If the departed person had access to any of these, rotate within 24 hours:
   - `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `FIRECRAWL_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `FB_APP_SECRET`, `CRON_SECRET`, `SYNC_SECRET`, `VERCEL_API_TOKEN`, `TWILIO_AUTH_TOKEN`, database password (`DATABASE_URL` / `DIRECT_URL`)
3. **Invalidate sessions.** Force-logout from Vercel and Supabase. NextAuth sessions are JWT-based so secret rotation in step 2 invalidates them.
4. **Update register.** Mark the row in `docs/ACCESS_REGISTER.md` as revoked, with a date.
5. **Spot-check provider audit logs** for any unusual activity in the prior 30 days.

---

## 6. Quarterly review

On the first business day of each quarter, the Owner runs through:

1. **Pull every account list** from each service in section 3.
2. **Verify against the access register.** Anyone not listed = remove. Anyone whose `expires-on` has passed = re-justify or remove.
3. **Confirm MFA still active** on every account.
4. **Rotate `CRON_SECRET` and `SYNC_SECRET`** if not rotated in the prior quarter.
5. **Review the `AdminAuditLog`** for the prior 90 days: confirm every privileged action ties to a known operator.
6. **Update this document's `Last reviewed` date** even if nothing changed.

---

## 7. Incident: suspected credential compromise

If a credential is suspected exposed (committed to a public repo, phished, employee laptop stolen):

1. **Immediately rotate** the affected secret per section 5.
2. **Force-rotate session secrets** (`NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`).
3. **Pull the provider's audit log** for the last 30 days; look for unfamiliar IPs / activity.
4. **Disable the suspected account** until investigation completes.
5. **Notify any affected users** if PII access cannot be ruled out (see GDPR/CCPA obligations in privacy policy).
6. **Document the incident** in `docs/INCIDENTS.md` (create on first use): trigger, scope, rotations performed, lessons learned.

---

## 8. Cross-references

- Incident response playbook: `SECURITY.md` (in repo root)
- DR/business continuity: `docs/DR_RUNBOOK.md`
- Privacy / data subject rights: `/privacy` route in production
- Audit log table: `AdminAuditLog` in Supabase production DB
