import "server-only";
// Sends queued Telegram alerts, retrying failures and dropping old ones

import type { TelegramDelivery } from "@prisma/client";
import { prisma } from "@/lib/db";
import { type TelegramSendResult } from "@/lib/telegram";
import { sendTelegramForUser } from "@/lib/telegram-settings";
export { enqueueTelegramDelivery, type EnqueueTelegramDelivery } from "@/lib/telegram-delivery-enqueue";

// Retry limits and timings for sending messages
export const MAX_DELIVERY_ATTEMPTS = 6;
export const DELIVERY_LEASE_MS = 60_000;
export const DEFAULT_WORKER_BATCH_SIZE = 10;
// Alerts older than 6 hours are dropped so the chat isn't flooded with old news
export const MAX_DELIVERY_AGE_MS = 6 * 60 * 60 * 1000;
export const EXPIRED_ERROR_CODE = "EXPIRED";

// Wait before the next retry: doubles each time (max 1 h), with some randomness
export function calculateRetryDelayMs(attemptCount: number, random = Math.random()) {
  const exponential = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
  // Random spread so many retries don't all fire at once
  return Math.round(exponential * (0.75 + Math.max(0, Math.min(1, random)) * 0.5));
}

// Short error code saved for a failed send
export function errorCodeForTelegramResult(result: Exclude<TelegramSendResult, { ok: true }>) {
  return result.providerCode ?? result.reason.toUpperCase();
}

// True if retrying won't help (bad setup or Telegram rejected the request)
export function isPermanentTelegramFailure(result: Exclude<TelegramSendResult, { ok: true }>) {
  if (result.reason === "configuration" || result.reason === "invalid-message") return true;
  // Telegram 4xx errors (except rate limits) won't be fixed by retrying
  return /^(HTTP|API)_(400|401|403|404)$/.test(result.providerCode ?? "");
}

// The database part this file needs (lets tests pass a fake)
type DeliveryStore = Pick<typeof prisma, "telegramDelivery">;

// Picks messages that are due and locks them so only one worker sends each
export async function claimDueTelegramDeliveries(
  store: DeliveryStore = prisma,
  options: { now?: Date; limit?: number; leaseMs?: number; userId?: string } = {},
) {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_WORKER_BATCH_SIZE, 25));
  const leaseExpiresAt = new Date(now.getTime() + (options.leaseMs ?? DELIVERY_LEASE_MS));
  // Expire old messages first so they are never sent
  await store.telegramDelivery.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - MAX_DELIVERY_AGE_MS) } },
    data: { status: "FAILED", lastErrorCode: EXPIRED_ERROR_CODE, leaseExpiresAt: null },
  });
  const candidates = await store.telegramDelivery.findMany({
    where: {
      ...(options.userId ? { userId: options.userId } : {}),
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "PROCESSING", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit * 2,
  });

  const claimed: TelegramDelivery[] = [];
  for (const candidate of candidates) {
    if (claimed.length === limit) break;
    // Only one worker can flip it to PROCESSING, so no message is sent twice
    const updated = await store.telegramDelivery.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: "PENDING", nextAttemptAt: { lte: now } },
          { status: "PROCESSING", leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
        leaseExpiresAt,
      },
    });
    if (updated.count !== 1) continue;
    const claimedDelivery = await store.telegramDelivery.findUnique({ where: { id: candidate.id } });
    if (claimedDelivery) claimed.push(claimedDelivery);
  }
  return claimed;
}

// Sends one message and marks it sent, retry later, or failed
export async function processTelegramDelivery(
  delivery: TelegramDelivery,
  store: DeliveryStore = prisma,
  // Tests pass a fake sender; normally the owner's own bot is used
  send?: (text: string) => Promise<TelegramSendResult>,
  now = new Date(),
) {
  const result = await (send ? send(delivery.messageText) : sendTelegramForUser(delivery.userId, delivery.messageText));
  const activeClaim = { id: delivery.id, status: "PROCESSING" as const, leaseExpiresAt: { gt: now } };

  if (result.ok) {
    await store.telegramDelivery.updateMany({
      where: activeClaim,
      data: {
        status: "SENT",
        sentAt: now,
        leaseExpiresAt: null,
        lastErrorCode: null,
        providerMessageId: result.providerMessageId ?? null,
      },
    });
    return { status: "sent" as const };
  }

  const errorCode = errorCodeForTelegramResult(result);
  const terminal = isPermanentTelegramFailure(result) || delivery.attemptCount >= MAX_DELIVERY_ATTEMPTS;
  await store.telegramDelivery.updateMany({
    where: activeClaim,
    data: terminal
      ? { status: "FAILED", leaseExpiresAt: null, lastErrorCode: errorCode, nextAttemptAt: now }
      : {
          status: "PENDING",
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          nextAttemptAt: new Date(now.getTime() + calculateRetryDelayMs(delivery.attemptCount)),
        },
  });
  return { status: terminal ? "failed" as const : "retry" as const, errorCode };
}

// Sends one batch of due messages and counts the results
export async function runTelegramDeliveryWorker(
  store: DeliveryStore = prisma,
  send?: (text: string) => Promise<TelegramSendResult>,
  options: { now?: Date; limit?: number; userId?: string } = {},
) {
  const now = options.now ?? new Date();
  const deliveries = await claimDueTelegramDeliveries(store, { now, limit: options.limit, userId: options.userId });
  const outcomes = await Promise.all(deliveries.map((delivery) => processTelegramDelivery(delivery, store, send, now)));
  return {
    claimed: deliveries.length,
    sent: outcomes.filter((outcome) => outcome.status === "sent").length,
    retried: outcomes.filter((outcome) => outcome.status === "retry").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
  };
}

// Sends batches until none are left (max 50 batches), used by the cron job
export async function runTelegramDeliveryWorkerUntilIdle(
  store: DeliveryStore = prisma,
  send?: (text: string) => Promise<TelegramSendResult>,
  options: { now?: Date; limit?: number; maxBatches?: number; userId?: string } = {},
) {
  const maxBatches = Math.max(1, Math.min(options.maxBatches ?? 10, 50));
  const total = { claimed: 0, sent: 0, retried: 0, failed: 0 };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await runTelegramDeliveryWorker(store, send, { now: options.now, limit: options.limit, userId: options.userId });
    total.claimed += result.claimed;
    total.sent += result.sent;
    total.retried += result.retried;
    total.failed += result.failed;
    if (result.claimed === 0) break;
  }

  return total;
}
