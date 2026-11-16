// Creates in-app bell notifications (no app imports, so any file can use it)
import type { NotificationType, Prisma, Severity } from "@prisma/client";

// The data for one notification
export interface AppNotification {
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
  severity?: Severity;
  actionUrl?: string;
  gardenId?: string | null;
  potId?: string | null;
  plantId?: string | null;
}

// The database (or a transaction) that can save notifications
type NotificationStore = Pick<Prisma.TransactionClient, "notification">;

// Saves a new notification
export function createAppNotification(store: NotificationStore, notification: AppNotification) {
  return store.notification.create({ data: notification });
}

// Saves a notification unless the same one (title + pot) exists since `since`
export async function createAppNotificationOnce(store: NotificationStore, notification: AppNotification, since: Date) {
  const existing = await store.notification.findFirst({
    where: {
      userId: notification.userId,
      title: notification.title,
      potId: notification.potId ?? undefined,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  if (existing) return null;
  return createAppNotification(store, notification);
}

// Link to a pot's watering page, used when a notification is clicked
export const potActionUrl = (gardenId: string | null | undefined, potId: string) =>
  gardenId ? `/irrigation?garden=${gardenId}&pot=${potId}` : "/irrigation";
