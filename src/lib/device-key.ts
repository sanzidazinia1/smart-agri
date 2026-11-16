// Creates and hashes the secret keys that boards use to log in
import crypto from "node:crypto";

// Makes a new board key; only its SHA-256 hash is saved, the key is shown once
export function generateDeviceKey() {
  const plain = `sk_dev_${crypto.randomBytes(24).toString("hex")}`;
  const hash = hashDeviceKey(plain);
  return { plain, hash };
}

// Hashes a board key with SHA-256 for safe storage and comparison
export function hashDeviceKey(plain: string) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}
