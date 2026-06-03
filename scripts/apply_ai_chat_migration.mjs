// One-off migration script: AI Chat Agent MVP schema.
// Run with DATABASE_URL/DIRECT_URL pulled from Vercel.
//
// Idempotent: every statement uses IF NOT EXISTS / IF EXISTS.

import pg from "pg";
const { Client } = pg;

// Postgres ALTER TYPE ADD VALUE cannot run inside a transaction block, so
// we issue each statement separately on a non-transactional connection.
const STATEMENTS = [
  `ALTER TYPE "CtaPreference" ADD VALUE IF NOT EXISTS 'ai_chat'`,

  `ALTER TABLE "Dealer"
     ADD COLUMN IF NOT EXISTS "aiChatEnabled" BOOLEAN NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS "aiChatDefaultLocale" TEXT NOT NULL DEFAULT 'auto',
     ADD COLUMN IF NOT EXISTS "bdcEmail" TEXT,
     ADD COLUMN IF NOT EXISTS "bdcPhone" TEXT`,

  `ALTER TABLE "Lead"
     ADD COLUMN IF NOT EXISTS "locale" TEXT,
     ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'web_form'`,

  `CREATE TABLE IF NOT EXISTS "ChatConversation" (
     "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     "dealerId" TEXT NOT NULL REFERENCES "Dealer"("id") ON DELETE CASCADE,
     "vehicleId" TEXT REFERENCES "Vehicle"("id") ON DELETE SET NULL,
     "listingId" TEXT REFERENCES "Listing"("id") ON DELETE SET NULL,
     "anonymousId" TEXT,
     "conversationToken" TEXT NOT NULL UNIQUE,
     "leadId" TEXT REFERENCES "Lead"("id") ON DELETE SET NULL,
     "locale" TEXT NOT NULL DEFAULT 'en',
     "capturedName" TEXT,
     "capturedEmail" TEXT,
     "capturedPhone" TEXT,
     "capturedIntent" TEXT,
     "status" TEXT NOT NULL DEFAULT 'active',
     "handoffRequestedAt" TIMESTAMPTZ,
     "dealerNotifiedAt" TIMESTAMPTZ,
     "visitorIpHash" TEXT,
     "visitorUserAgent" TEXT,
     "visitorReferer" TEXT,
     "dealerReadAt" TIMESTAMPTZ,
     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE INDEX IF NOT EXISTS "ChatConversation_dealerId_updatedAt_idx" ON "ChatConversation"("dealerId", "updatedAt" DESC)`,
  `CREATE INDEX IF NOT EXISTS "ChatConversation_leadId_idx" ON "ChatConversation"("leadId")`,
  `CREATE INDEX IF NOT EXISTS "ChatConversation_dealerId_status_idx" ON "ChatConversation"("dealerId", "status")`,
  `CREATE INDEX IF NOT EXISTS "ChatConversation_anonymousId_idx" ON "ChatConversation"("anonymousId")`,

  `CREATE TABLE IF NOT EXISTS "ChatMessage" (
     "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     "conversationId" TEXT NOT NULL REFERENCES "ChatConversation"("id") ON DELETE CASCADE,
     "role" TEXT NOT NULL,
     "body" TEXT NOT NULL,
     "toolCalls" JSONB,
     "detectedLocale" TEXT,
     "dealerRepName" TEXT,
     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt")`,

  `CREATE TABLE IF NOT EXISTS "KbEntry" (
     "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     "dealerId" TEXT NOT NULL REFERENCES "Dealer"("id") ON DELETE CASCADE,
     "locale" TEXT NOT NULL DEFAULT 'en',
     "question" TEXT NOT NULL,
     "answer" TEXT NOT NULL,
     "category" TEXT NOT NULL DEFAULT 'custom',
     "sourceEntryId" TEXT REFERENCES "KbEntry"("id") ON DELETE SET NULL,
     "embedding" REAL[],
     "active" BOOLEAN NOT NULL DEFAULT true,
     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS "KbEntry_dealerId_locale_active_idx" ON "KbEntry"("dealerId", "locale", "active")`,
  `CREATE INDEX IF NOT EXISTS "KbEntry_sourceEntryId_idx" ON "KbEntry"("sourceEntryId")`,
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
  const preview = s.replace(/\s+/g, " ").slice(0, 80);
  try {
    await client.query(s);
    console.log(`✓ [${i + 1}/${STATEMENTS.length}] ${preview}...`);
  } catch (err) {
    console.error(`✗ [${i + 1}/${STATEMENTS.length}] ${preview}...`);
    console.error("  ", err.message);
    throw err;
  }
}

await client.end();
console.log("\nAll migrations applied successfully.");
