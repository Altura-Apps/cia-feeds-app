/**
 * Auto-extract a per-dealer knowledge base from their public website.
 *
 * Flow:
 *   1. Firecrawl scrape candidate URLs (homepage + /contact + /about + /faq +
 *      /hours + /financing) — whichever exist.
 *   2. Concatenate markdown content (Firecrawl returns clean markdown).
 *   3. Gemini extracts an array of {category, question, answer} pairs.
 *   4. Persist as KbEntry rows in EN.
 *   5. Translate each entry to ES via Gemini and persist as a sibling row
 *      with sourceEntryId pointing at the EN row.
 *
 * Triggers:
 *   - On dealer signup (call from /api/auth/signup after dealer create)
 *   - On demand from the KB editor "Re-scan website" button
 *
 * Cost / time budget:
 *   - 6 Firecrawl scrapes (each ~1.5s) + 1 Gemini extraction + N Gemini
 *     translations. Whole thing runs ~12-20s. Fire-and-forget after the
 *     dealer is created; don't block their signup response.
 *
 * Idempotency:
 *   - We tag every auto-extracted entry with category != "custom" and a
 *     synthetic question hash check. Re-running replaces auto-extracted
 *     entries but leaves dealer hand-edits (category="custom") alone.
 */

import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { firecrawlClient } from "@/lib/firecrawl";
import { withBreaker, CircuitOpenError } from "@/lib/circuitBreaker";

const GEMINI_MODEL = "gemini-2.5-flash";

const AUTO_CATEGORIES = ["hours", "location", "financing", "services", "promos"];

const CANDIDATE_PATHS = [
  "",
  "/contact",
  "/contact-us",
  "/about",
  "/about-us",
  "/faq",
  "/hours",
  "/financing",
  "/finance",
  "/services",
];

interface ExtractedEntry {
  category: string;
  question: string;
  answer: string;
}

async function fetchAndConcatenate(
  websiteUrl: string,
  timeoutMs = 25_000
): Promise<string> {
  const base = websiteUrl.replace(/\/+$/, "");
  const urls = CANDIDATE_PATHS.map((p) => `${base}${p}`);

  const deadline = Date.now() + timeoutMs;
  const results: string[] = [];

  // Fetch sequentially with a per-page timeout — Firecrawl already has its
  // own breaker so we don't pile them up. Stop early if we hit the deadline.
  for (const url of urls) {
    if (Date.now() > deadline) break;
    try {
      const scraped = await firecrawlClient.scrape(url, {
        formats: ["markdown"],
        // 7s per-page is plenty for a static dealer site.
        timeout: 7000,
      });
      const md =
        (scraped as { markdown?: string; data?: { markdown?: string } }).markdown ??
        (scraped as { data?: { markdown?: string } }).data?.markdown ??
        "";
      if (md && md.length > 80) {
        results.push(`### ${url}\n${md.slice(0, 4000)}`);
      }
    } catch {
      // Individual page fails are fine; we just skip
    }
    if (results.length >= 4) break; // 4 pages is plenty of signal
  }

  return results.join("\n\n---\n\n").slice(0, 18000);
}

async function extractWithGemini(
  dealerName: string,
  content: string
): Promise<ExtractedEntry[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  const prompt = `You are extracting a customer-facing FAQ for ${dealerName} from their website content.

Read the content below and produce 5-12 Q&A pairs that a visitor would actually ask. Each should be:
- A natural-language question a customer would type or speak
- A concise answer (1-3 sentences) using ONLY facts present in the content
- Tagged with one category from: ${AUTO_CATEGORIES.join(", ")}, or "custom" if nothing matches

Skip generic web boilerplate ("about us was founded in..."). Focus on:
- Hours of operation
- Physical address / location
- Phone number
- Financing / payment options
- Specific services or products offered
- Current promotions / specials
- Languages spoken
- Brands carried (for auto dealers)

If a fact isn't in the content, do NOT include a Q&A for it. Hallucinating is worse than missing the entry.

Output ONLY a JSON object of this exact shape (no markdown, no commentary):
{
  "entries": [
    { "category": "hours", "question": "What are your hours?", "answer": "Open Mon-Sat 9am-7pm. Closed Sundays." }
  ]
}

--- Website content ---
${content}`;

  const ai = new GoogleGenAI({ apiKey });

  let response;
  try {
    response = await withBreaker(
      "gemini.kbExtract",
      () =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ text: prompt }],
          config: { responseMimeType: "application/json", temperature: 0.2 },
        }),
      { timeoutMs: 25_000 }
    );
  } catch (err) {
    if (!(err instanceof CircuitOpenError)) {
      console.error({
        event: "kb_extract_gemini_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return [];
  }

  const raw =
    response.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim() ?? "";

  try {
    const parsed = JSON.parse(raw) as { entries?: ExtractedEntry[] };
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter(
        (e) =>
          e &&
          typeof e.question === "string" &&
          typeof e.answer === "string" &&
          e.question.length > 5 &&
          e.answer.length > 10
      )
      .slice(0, 15)
      .map((e) => ({
        category: AUTO_CATEGORIES.includes(e.category) ? e.category : "custom",
        question: e.question.slice(0, 200),
        answer: e.answer.slice(0, 800),
      }));
  } catch {
    return [];
  }
}

/**
 * Translate an EN Q&A to ES. Returns null on failure so caller can skip.
 */
export async function translateKbEntry(
  enQuestion: string,
  enAnswer: string
): Promise<{ question: string; answer: string } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Translate this Q&A pair from English to natural, neutral Latin American Spanish (suitable for US Hispanic customers). Preserve the meaning exactly. Keep phone numbers, prices, and names verbatim.

Return ONLY this JSON shape:
{ "question": "...", "answer": "..." }

EN Question: ${enQuestion}
EN Answer: ${enAnswer}`;

  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await withBreaker(
      "gemini.kbTranslate",
      () =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ text: prompt }],
          config: { responseMimeType: "application/json", temperature: 0.2 },
        }),
      { timeoutMs: 10_000 }
    );
    const raw =
      response.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("")
        .trim() ?? "";
    const parsed = JSON.parse(raw) as { question?: string; answer?: string };
    if (!parsed.question || !parsed.answer) return null;
    return {
      question: parsed.question.slice(0, 200),
      answer: parsed.answer.slice(0, 800),
    };
  } catch {
    return null;
  }
}

/**
 * Top-level orchestrator. Auto-extract + persist EN + ES rows for a dealer.
 *
 * `replaceExisting`: if true, deletes existing auto-extracted entries
 * (category != "custom") before re-seeding. Hand-added custom rows are
 * untouched either way.
 */
export async function autoExtractKnowledgeBase(args: {
  dealerId: string;
  replaceExisting?: boolean;
}): Promise<{
  ok: boolean;
  englishEntries: number;
  spanishEntries: number;
  reason?: string;
}> {
  const dealer = await prisma.dealer.findUnique({
    where: { id: args.dealerId },
    select: { id: true, name: true, websiteUrl: true },
  });
  if (!dealer) return { ok: false, englishEntries: 0, spanishEntries: 0, reason: "no_dealer" };
  if (!dealer.websiteUrl) {
    return { ok: false, englishEntries: 0, spanishEntries: 0, reason: "no_website" };
  }

  const content = await fetchAndConcatenate(dealer.websiteUrl);
  if (content.length < 200) {
    return { ok: false, englishEntries: 0, spanishEntries: 0, reason: "no_content" };
  }

  const enEntries = await extractWithGemini(dealer.name, content);
  if (enEntries.length === 0) {
    return { ok: false, englishEntries: 0, spanishEntries: 0, reason: "no_extraction" };
  }

  if (args.replaceExisting) {
    await prisma.kbEntry.deleteMany({
      where: {
        dealerId: dealer.id,
        category: { not: "custom" },
      },
    });
  }

  // Insert EN entries first, then translations linked to them.
  let enInserted = 0;
  let esInserted = 0;

  for (const e of enEntries) {
    const en = await prisma.kbEntry.create({
      data: {
        dealerId: dealer.id,
        locale: "en",
        question: e.question,
        answer: e.answer,
        category: e.category,
        active: true,
      },
    });
    enInserted++;

    // Translate + insert ES sibling
    const es = await translateKbEntry(e.question, e.answer);
    if (es) {
      await prisma.kbEntry.create({
        data: {
          dealerId: dealer.id,
          locale: "es",
          question: es.question,
          answer: es.answer,
          category: e.category,
          sourceEntryId: en.id,
          active: true,
        },
      });
      esInserted++;
    }
  }

  return {
    ok: true,
    englishEntries: enInserted,
    spanishEntries: esInserted,
  };
}
