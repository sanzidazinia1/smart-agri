// Helpers for pairing a new board to the app with a 6-digit code
import crypto from "node:crypto";

// A waiting board silent this long is hidden from "New devices found"
export const PAIRING_VISIBLE_MS = 30 * 1000;
// A claimed board must collect its key within this time
export const KEY_DELIVERY_TTL_MS = 15 * 60 * 1000;
// Wrong codes allowed before the user must press "new code" on the board
export const MAX_FAILED_ATTEMPTS = 5;
// How long the board waits for its BOOT button after the app asks
export const CONFIRM_WINDOW_MS = 30 * 1000;

// Allowed formats for hardware ID, pairing code and board secret
const HARDWARE_ID = /^[A-Za-z0-9_-]{3,64}$/;
const PAIRING_CODE = /^\d{6}$/;
const SECRET = /^[A-Za-z0-9]{16,128}$/;

// True if the hardware ID has a valid format
export function isValidHardwareId(value: string) {
  return HARDWARE_ID.test(value);
}

// True if the board's secret has a valid format
export function isValidSecret(value: string) {
  return SECRET.test(value);
}

// Accepts "482 913", "482-913" etc.; returns the 6 digits or null
export function normalizePairingCode(input: string) {
  const digits = input.replace(/\D/g, "");
  return PAIRING_CODE.test(digits) ? digits : null;
}

// Hashes the board's secret with SHA-256 so it isn't stored in plain text
export function hashPairingSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

// Compares codes in constant time so they can't be guessed by timing
export function pairingCodesMatch(expected: string, provided: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// True if the waiting board checked in recently enough to show
export function isPairingVisible(lastSeenAt: Date, now = new Date()) {
  return now.getTime() - lastSeenAt.getTime() <= PAIRING_VISIBLE_MS;
}

// Saved pairing info for a board
export type PairingState = {
  secretHash: string;
  claimedAt: Date | null;
  pendingKey: string | null;
  keyExpiresAt: Date | null;
};

// When a board checks in: "reset" (start over), "deliver" (give key) or "wait"
export function announceAction(existing: PairingState | null, secretHash: string, now = new Date()) {
  if (!existing || existing.secretHash !== secretHash) return "reset" as const;
  if (existing.claimedAt && existing.pendingKey && existing.keyExpiresAt && existing.keyExpiresAt > now) {
    return "deliver" as const;
  }
  if (existing.claimedAt) return "reset" as const; // key expired or already taken; start over
  return "wait" as const;
}

// True if the app asked for a button press and it's not too late
export function isConfirmPending(confirmRequestedAt: Date | null, now = new Date()) {
  return Boolean(confirmRequestedAt && now.getTime() - confirmRequestedAt.getTime() <= CONFIRM_WINDOW_MS);
}
