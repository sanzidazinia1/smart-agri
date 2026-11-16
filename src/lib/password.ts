// Hashes and checks user passwords safely with scrypt
import crypto from "node:crypto";

// Hashes a password with a random salt; returns the hash and the salt
export function hashPassword(password: string, salt?: string) {
  const passwordSalt = salt || crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto
    .scryptSync(password, passwordSalt, 64)
    .toString("hex");
  return { passwordHash, passwordSalt };
}

// Checks a password against the saved hash (constant-time compare)
export function verifyPassword(
  password: string,
  passwordHash: string,
  passwordSalt: string,
) {
  const candidateHash = crypto.scryptSync(password, passwordSalt, 64);
  const storedHash = Buffer.from(passwordHash, "hex");
  return (
    storedHash.length === candidateHash.length &&
    crypto.timingSafeEqual(storedHash, candidateHash)
  );
}
