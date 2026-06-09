// Plan-tiers migration: adds Plan enum + Dealer.plan column + crawl
// quota / URL-by-URL counters. Idempotent.

import pg from "pg";
const { Client } = pg;

const STATEMENTS = [
  // 1. Plan enum
  `DO $$ BEGIN
     CREATE TYPE "Plan" AS ENUM ('trial', 'starter', 'pro', 'enterprise');
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`,

  // 2. Dealer.plan + quota tracking columns
  `ALTER TABLE "Dealer"
     ADD COLUMN IF NOT EXISTS "plan" "Plan" NOT NULL DEFAULT 'trial',
     ADD COLUMN IF NOT EXISTS "trialUrlAddsUsed" INTEGER NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS "customCrawlExcludePatterns" TEXT[] DEFAULT NULL`,

  // 3. Backfill existing customers based on their Stripe price.
  //    Anyone currently subscribed to the legacy $99 price OR currently
  //    active before today gets mapped to 'starter' for grandfathering.
  //    Anyone subscribed to the new $299 price gets 'pro'.
  //    Everyone else (no sub, fresh signups) stays at 'trial'.
  //
  //    We do this by looking at subscriptionStatus + stripeSubscriptionId
  //    presence — the precise plan can be refined later via the Stripe
  //    webhook handler updating Dealer.plan in lock-step with price changes.
  `UPDATE "Dealer"
     SET "plan" = 'starter'
     WHERE "plan" = 'trial'
       AND "subscriptionStatus" IN ('active','trialing','past_due')
       AND "stripeSubscriptionId" IS NOT NULL
       AND "createdAt" < NOW() - INTERVAL '14 days'`,

  // 4. Index for plan-based queries (cron quota checks, admin filtering)
  `CREATE INDEX IF NOT EXISTS "Dealer_plan_idx" ON "Dealer"("plan")`,
];

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DIRECT_URL/DATABASE_URL");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

for (let i = 0; i < STATEMENTS.length; i++) {
  const s = STATEMENTS[i];
  const preview = s.replace(/\s+/g, " ").slice(0, 90);
  try {
    const result = await client.query(s);
    const extra = result.rowCount ? ` (${result.rowCount} rows)` : "";
    console.log(`\u2713 [${i + 1}/${STATEMENTS.length}] ${preview}...${extra}`);
  } catch (err) {
    console.error(`\u2717 [${i + 1}/${STATEMENTS.length}] ${preview}...`);
    console.error("  ", err.message);
    throw err;
  }
}

await client.end();
console.log("\nAll migrations applied successfully.");
