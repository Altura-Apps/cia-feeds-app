-- =====================================================================
-- 20260609_lock_rls_on_public_tables.sql
--
-- Closes findings from Supabase Security Advisor:
--   * rls_disabled_in_public  (13 tables)
--   * security_definer_view   (lw_hourly_rollup)
--   * sensitive_columns_exposed (lw_sessions.token)
--
-- Strategy: Supabase exposes everything in `public` via PostgREST. The
-- anon/authenticated roles get default SELECT/INSERT/UPDATE/DELETE grants
-- on new tables in this schema. This app does NOT use the anon key — all
-- data access is through Prisma over DIRECT_URL (postgres role, which
-- bypasses RLS). We therefore enable RLS without any policies, which
-- blocks ALL anon + authenticated traffic by default. service_role and
-- postgres are unaffected (BYPASSRLS).
--
-- Defense in depth: also REVOKE the auto-grants from anon/authenticated.
-- =====================================================================

BEGIN;

-- ---------------- logwatch (lw_*) tables ----------------
ALTER TABLE public.lw_raw_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lw_traffic_timeline   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lw_alerts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lw_suspicious_ips     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lw_blocked_ips        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lw_traffic_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lw_otps               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lw_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lw_allowed_emails     ENABLE ROW LEVEL SECURITY;

-- ---------------- AI Chat tables ----------------
ALTER TABLE public."ChatConversation"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChatMessage"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."KbEntry"             ENABLE ROW LEVEL SECURITY;

-- ---------------- Defense in depth: revoke API grants ----------------
-- These tables are never accessed via PostgREST; the Next.js API routes
-- use Prisma (postgres role) and the only Supabase JS use is for Storage
-- with the service_role key. Pull the rug from anon/authenticated.
REVOKE ALL ON public.lw_raw_events,
              public.lw_traffic_timeline,
              public.lw_alerts,
              public.lw_suspicious_ips,
              public.lw_blocked_ips,
              public.lw_traffic_entries,
              public.lw_otps,
              public.lw_sessions,
              public.lw_allowed_emails,
              public."ChatConversation",
              public."ChatMessage",
              public."KbEntry"
       FROM anon, authenticated;

-- ---------------- Fix SECURITY DEFINER view ----------------
-- The view aggregates lw_raw_events. Without security_invoker=true,
-- the view bypasses RLS on the underlying table because it inherits
-- the view-creator's (postgres) permissions. Switching to invoker mode
-- means the caller's RLS applies — combined with the RLS we just
-- enabled on lw_raw_events, anon callers now get nothing.
ALTER VIEW public.lw_hourly_rollup SET (security_invoker = true);

-- Also revoke API grants on the view itself.
REVOKE ALL ON public.lw_hourly_rollup FROM anon, authenticated;

COMMIT;

-- =====================================================================
-- Sanity-check queries (run separately, not part of the transaction):
--
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relnamespace='public'::regnamespace
--   AND relname IN ('lw_raw_events','ChatMessage','KbEntry','lw_sessions');
--
-- SELECT relname, reloptions FROM pg_class WHERE relname='lw_hourly_rollup';
--
-- SET ROLE anon;
-- SELECT * FROM public."ChatMessage" LIMIT 1;   -- should return 0 rows
-- RESET ROLE;
-- =====================================================================
