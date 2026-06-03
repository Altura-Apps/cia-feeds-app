/**
 * Dealer-scoped KB API.
 *
 *   GET    /api/dealer/kb              List all KB entries (both locales)
 *   POST   /api/dealer/kb              Create a new EN entry; auto-translate to ES
 *   PATCH  /api/dealer/kb?id=<id>      Update question/answer/category/active
 *   DELETE /api/dealer/kb?id=<id>      Delete entry (and its translation sibling)
 *   POST   /api/dealer/kb/scan         Run autoExtractKnowledgeBase
 *
 * Auth: dealer-scoped via getEffectiveDealerContext.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveDealerContext } from "@/lib/impersonation";
import { translateKbEntry } from "@/lib/kbAutoExtract";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["hours", "location", "financing", "services", "promos", "custom"];

export async function GET() {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const entries = await prisma.kbEntry.findMany({
    where: { dealerId: effectiveDealerId },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { question?: unknown; answer?: unknown; category?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  const category =
    typeof body.category === "string" && VALID_CATEGORIES.includes(body.category)
      ? body.category
      : "custom";

  if (question.length < 5 || answer.length < 5) {
    return NextResponse.json(
      { error: "question_and_answer_required" },
      { status: 400 }
    );
  }

  const en = await prisma.kbEntry.create({
    data: {
      dealerId: effectiveDealerId,
      locale: "en",
      question: question.slice(0, 200),
      answer: answer.slice(0, 800),
      category,
      active: true,
    },
  });

  // Best-effort ES translation
  const es = await translateKbEntry(question, answer);
  let esRow = null;
  if (es) {
    esRow = await prisma.kbEntry.create({
      data: {
        dealerId: effectiveDealerId,
        locale: "es",
        question: es.question,
        answer: es.answer,
        category,
        sourceEntryId: en.id,
        active: true,
      },
    });
  }

  return NextResponse.json({ en, es: esRow });
}

export async function PATCH(request: NextRequest) {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  let body: {
    question?: unknown;
    answer?: unknown;
    category?: unknown;
    active?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const existing = await prisma.kbEntry.findFirst({
    where: { id, dealerId: effectiveDealerId },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const data: {
    question?: string;
    answer?: string;
    category?: string;
    active?: boolean;
  } = {};
  if (typeof body.question === "string" && body.question.trim().length >= 5) {
    data.question = body.question.trim().slice(0, 200);
  }
  if (typeof body.answer === "string" && body.answer.trim().length >= 5) {
    data.answer = body.answer.trim().slice(0, 800);
  }
  if (
    typeof body.category === "string" &&
    VALID_CATEGORIES.includes(body.category)
  ) {
    data.category = body.category;
  }
  if (typeof body.active === "boolean") {
    data.active = body.active;
  }

  const updated = await prisma.kbEntry.update({ where: { id }, data });
  return NextResponse.json({ entry: updated });
}

export async function DELETE(request: NextRequest) {
  const { effectiveDealerId } = await getEffectiveDealerContext();
  if (!effectiveDealerId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  const existing = await prisma.kbEntry.findFirst({
    where: { id, dealerId: effectiveDealerId },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Delete this entry and any siblings (translations) referencing it.
  await prisma.kbEntry.deleteMany({
    where: {
      OR: [
        { id },
        { sourceEntryId: id },
      ],
      dealerId: effectiveDealerId,
    },
  });

  return NextResponse.json({ ok: true });
}
