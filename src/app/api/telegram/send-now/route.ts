// API /api/telegram/send-now: send queued Telegram alerts now, not on schedule
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";

export const runtime = "nodejs";

// POST: send this user's queued alerts (safe to repeat; no double sends)
export async function POST() {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { getUserTelegramConfig } = await import("@/lib/telegram-settings");
  if (!(await getUserTelegramConfig(gate))) {
    return NextResponse.json({ error: "Connect Telegram first." }, { status: 400 });
  }
  const { runTelegramDeliveryWorkerUntilIdle } = await import("@/lib/telegram-outbox");
  const result = await runTelegramDeliveryWorkerUntilIdle(undefined, undefined, { userId: gate });
  return NextResponse.json(result);
}
