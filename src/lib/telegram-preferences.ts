// Lets env vars turn each type of Telegram alert on or off
import type { TelegramDeliveryEventType } from "@prisma/client";

// Alert types that can be switched off
type PreferenceName =
  | "PUMP_ACKNOWLEDGED"
  | "PUMP_FAILED"
  | "DISEASE_ANALYSIS_COMPLETED"
  | "DEVICE_OFFLINE"
  | "DEVICE_RECOVERED";

// Env var that controls each alert type
const ENVIRONMENT_KEYS: Record<PreferenceName, string> = {
  PUMP_ACKNOWLEDGED: "TELEGRAM_NOTIFY_PUMP_ACKNOWLEDGED",
  PUMP_FAILED: "TELEGRAM_NOTIFY_PUMP_FAILED",
  DISEASE_ANALYSIS_COMPLETED: "TELEGRAM_NOTIFY_DISEASE_ANALYSIS",
  DEVICE_OFFLINE: "TELEGRAM_NOTIFY_DEVICE_OFFLINE",
  DEVICE_RECOVERED: "TELEGRAM_NOTIFY_DEVICE_RECOVERED",
};

// On unless the value is exactly "false"
function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() !== "false";
}

// True if this alert type should be sent (all on unless set to "false")
export function isTelegramEventEnabled(eventType: TelegramDeliveryEventType) {
  return enabled(process.env[ENVIRONMENT_KEYS[eventType as PreferenceName]]);
}
