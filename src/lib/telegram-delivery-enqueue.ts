// Adds a Telegram alert to the send queue inside a database transaction
import type { Prisma, TelegramDeliveryEventType } from "@prisma/client";
import { isTelegramEventEnabled } from "@/lib/telegram-preferences";

// The data for one queued Telegram message
export type EnqueueTelegramDelivery = {
  userId: string;
  eventKey: string;
  eventType: TelegramDeliveryEventType;
  eventRef: string;
  messageText: string;
};

// Queues a message once (same eventKey is skipped) if that alert type is on
export function enqueueTelegramDelivery(
  tx: Prisma.TransactionClient,
  delivery: EnqueueTelegramDelivery,
) {
  if (!isTelegramEventEnabled(delivery.eventType)) return Promise.resolve({ count: 0 });
  return tx.telegramDelivery.createMany({ data: delivery, skipDuplicates: true });
}
