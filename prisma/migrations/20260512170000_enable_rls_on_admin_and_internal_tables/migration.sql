-- Enable Row Level Security on internal/admin tables.
--
-- These tables are accessed only from server code via Prisma (using the
-- postgres role through DATABASE_URL) or via the Supabase service-role key.
-- Both bypass RLS automatically, so enabling RLS without any policies is the
-- correct way to lock out the anon/authenticated client roles — anyone who
-- holds the public anon/publishable key cannot read or modify these rows.
--
-- Background: Supabase's PostgREST exposes every table in the `public` schema
-- to the anon and authenticated roles by default. Disabling RLS on these
-- tables effectively makes them world-readable/writable via the public anon
-- key (which is shipped to every browser as NEXT_PUBLIC_SUPABASE_URL +
-- publishable key). `AdminAllowlist` and `AdminAuditLog` are especially
-- sensitive — an attacker inserting their email into AdminAllowlist could
-- escalate to admin on next login.

ALTER TABLE public."MetaCatalogSyncItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MetaDeliveryJob"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AdminAllowlist"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AdminAuditLog"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RateLimitBucket"     ENABLE ROW LEVEL SECURITY;
