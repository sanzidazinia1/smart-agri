// Remote actions (restart, reset Wi-Fi, sleep, factory reset) queued for a board
import type { DeviceAction } from "@prisma/client";

// All actions the app can send to a board
export const DEVICE_ACTIONS = ["RESTART", "RESET_WIFI", "SLEEP", "FACTORY_RESET"] as const satisfies readonly DeviceAction[];

// A queued action not picked up by the board within this time is dropped
export const ACTION_TTL_MS = 2 * 60 * 1000;

// True if a queued action is still waiting and not yet expired
export function isActionLive(action: DeviceAction | null, queuedAt: Date | null, now = new Date()) {
  return Boolean(action && queuedAt && now.getTime() - queuedAt.getTime() < ACTION_TTL_MS);
}
