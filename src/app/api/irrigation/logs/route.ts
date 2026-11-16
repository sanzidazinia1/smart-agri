// API /api/irrigation/logs: watering history (auto and manual), page by page
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// Page size: 20 by default, never more than 50
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// GET: newest events first; ?since= on page 1 also adds a watering summary
export async function GET(req: Request) {
  // Auth check: only logged-in users; results are always their own
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;

  const { searchParams } = new URL(req.url);
  const gardenId = searchParams.get("gardenId") || undefined;
  const potId = searchParams.get("potId") || undefined;
  const cursor = searchParams.get("cursor") || undefined;
  const mode = searchParams.get("mode");
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT));

  // Filters: this user, optional garden/pot, optional auto/manual mode
  const scope: Prisma.IrrigationEventWhereInput = {
    userId: gate,
    ...(gardenId ? { gardenId } : {}),
    ...(potId ? { potId } : {}),
  };
  const where: Prisma.IrrigationEventWhereInput = {
    ...scope,
    ...(mode === "automatic" || mode === "manual" ? { mode } : {}),
  };

  // Fetch one extra row to know if there is a next page
  const rows = await prisma.irrigationEvent.findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      mode: true,
      status: true,
      reason: true,
      decision: true,
      soilMoisture: true,
      onThreshold: true,
      offThreshold: true,
      startedAt: true,
    },
  });
  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? items[items.length - 1].id : null;

  const sinceParam = searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  const summary = !cursor && since && !Number.isNaN(since.getTime()) ? await summarize(scope, since) : undefined;

  return NextResponse.json({ items, nextCursor, summary });
}

/** Waterings since `since`: how many, how long the pump ran, and the last one ever. */
async function summarize(scope: Prisma.IrrigationEventWhereInput, since: Date) {
  const pumpScope = { ...scope, decision: { in: ["PUMP_ON", "PUMP_OFF"] } };
  const [events, last] = await Promise.all([
    prisma.irrigationEvent.findMany({
      where: { ...pumpScope, startedAt: { gte: since } },
      orderBy: { startedAt: "asc" },
      select: { decision: true, startedAt: true },
    }),
    prisma.irrigationEvent.findFirst({
      where: { ...scope, decision: "PUMP_ON" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
  ]);

  let waterings = 0;
  let runMs = 0;
  let onAt: Date | null = null;
  // Pair each PUMP_ON with the next PUMP_OFF to add up run time
  for (const event of events) {
    if (event.decision === "PUMP_ON") {
      waterings += 1;
      onAt ??= event.startedAt;
    } else if (onAt) {
      runMs += event.startedAt.getTime() - onAt.getTime();
      onAt = null;
    }
  }
  // Still running: count up to now.
  if (onAt) runMs += Date.now() - onAt.getTime();

  return { waterings, runSeconds: Math.round(runMs / 1000), lastWateredAt: last?.startedAt ?? null };
}
