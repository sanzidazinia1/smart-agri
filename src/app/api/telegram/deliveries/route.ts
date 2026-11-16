// API /api/telegram/deliveries: history of Telegram messages sent to the user
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// GET: last 50 deliveries; security: never return chat ref or message text
export async function GET() {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;

  const deliveries = await prisma.telegramDelivery.findMany({
    where: { userId: gate },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      eventType: true,
      status: true,
      attemptCount: true,
      lastErrorCode: true,
      createdAt: true,
      sentAt: true,
      lastAttemptAt: true,
    },
  });
  return NextResponse.json(deliveries);
}
