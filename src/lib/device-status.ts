// Works out if a board is online, delayed (stale) or offline from its last data

// The possible connection states of a board
export type DeviceConnectionStatus = "NEVER_SEEN" | "ONLINE" | "STALE" | "OFFLINE";

// Board reports every 20 s: ~2 missed = delayed, ~4 missed = offline
export const DEFAULT_DEVICE_STALE_THRESHOLD_SECONDS = 45;
export const DEFAULT_DEVICE_OFFLINE_THRESHOLD_SECONDS = 90;

// Environment variables as a simple key/value object
type Environment = Record<string, string | undefined>;

// Reads a seconds value from env, or undefined if invalid
function configuredSeconds(value: string | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : undefined;
}

// Stale/offline time limits (ms), based only on when we last got valid data
export function getDeviceConnectionThresholds(env: Environment = process.env) {
  const offlineSeconds = configuredSeconds(env.DEVICE_OFFLINE_THRESHOLD_SECONDS)
    ?? DEFAULT_DEVICE_OFFLINE_THRESHOLD_SECONDS;
  const requestedStaleSeconds = configuredSeconds(env.DEVICE_STALE_THRESHOLD_SECONDS)
    ?? DEFAULT_DEVICE_STALE_THRESHOLD_SECONDS;

  // Keep stale below offline, even if only the offline limit was set
  const staleSeconds = Math.min(requestedStaleSeconds, Math.max(0, offlineSeconds - 1));
  return { staleMs: staleSeconds * 1_000, offlineMs: offlineSeconds * 1_000 };
}

// Returns ONLINE, STALE, OFFLINE or NEVER_SEEN for a board
export function getDeviceConnectionStatus(
  lastSeenAt: Date | null | undefined,
  now = new Date(),
  env: Environment = process.env,
): DeviceConnectionStatus {
  if (!(lastSeenAt instanceof Date) || Number.isNaN(lastSeenAt.getTime()) || lastSeenAt > now) {
    return "NEVER_SEEN";
  }

  const ageMs = now.getTime() - lastSeenAt.getTime();
  const { staleMs, offlineMs } = getDeviceConnectionThresholds(env);
  if (ageMs <= staleMs) return "ONLINE";
  if (ageMs <= offlineMs) return "STALE";
  return "OFFLINE";
}
