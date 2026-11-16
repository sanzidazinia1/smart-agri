// API /api/iot/pair: a new ESP32 announces itself here until it gets its key
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { claimTargetError, completeClaim } from "@/lib/device-claim";
import {
  CONFIRM_WINDOW_MS,
  announceAction,
  hashPairingSecret,
  isConfirmPending,
  isValidHardwareId,
  isValidSecret,
  normalizePairingCode,
} from "@/lib/device-pairing";

// Validation schema: what the board sends each time it announces
const schema = z.object({
  hardwareId: z.string().trim(),
  secret: z.string().trim(),
  pairingCode: z.string().trim(),
  firmware: z.string().trim().max(40).optional(),
  confirm: z.boolean().optional(),
});

// POST: reply "waiting", "confirm" (press BOOT) or "claimed" with the key once
export async function POST(req: Request) {
  // Security: no login; board's secret + BOOT press (or code) prove ownership
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const code = parsed.success ? normalizePairingCode(parsed.data.pairingCode) : null;
  if (!parsed.success || !code || !isValidHardwareId(parsed.data.hardwareId) || !isValidSecret(parsed.data.secret)) {
    return NextResponse.json({ error: "Invalid pairing announcement" }, { status: 400 });
  }
  const { hardwareId, secret, firmware, confirm } = parsed.data;
  // Only the secret's hash is stored and compared
  const secretHash = hashPairingSecret(secret);
  const now = new Date();

  const existing = await prisma.devicePairing.findUnique({ where: { hardwareId } });
  // Decide: hand over the key, start fresh, or just note the board is alive
  const action = announceAction(existing, secretHash, now);

  if (action === "deliver" && existing) {
    // Claimed with the pairing code: hand the key over once, then forget it.
    await prisma.devicePairing.update({
      where: { hardwareId },
      data: { pendingKey: null, keyExpiresAt: null, lastSeenAt: now },
    });
    return NextResponse.json({ status: "claimed", deviceKey: existing.pendingKey, hardwareId });
  }

  // New or reset board: (re)create its pairing record and wait to be claimed
  if (action === "reset") {
    await prisma.devicePairing.upsert({
      where: { hardwareId },
      create: { hardwareId, secretHash, pairingCode: code, firmware, lastSeenAt: now },
      update: {
        secretHash,
        pairingCode: code,
        firmware,
        lastSeenAt: now,
        failedAttempts: 0,
        claimedAt: null,
        claimedByUserId: null,
        deviceId: null,
        pendingKey: null,
        keyExpiresAt: null,
        confirmRequestedAt: null,
      },
    });
    return NextResponse.json({ status: "waiting" });
  }

  await prisma.devicePairing.update({ where: { hardwareId }, data: { lastSeenAt: now, firmware } });

  // User asked to claim it: wait for BOOT press, then finish the claim
  if (existing && isConfirmPending(existing.confirmRequestedAt, now) && existing.requestUserId) {
    if (!confirm) {
      const msLeft = CONFIRM_WINDOW_MS - (now.getTime() - existing.confirmRequestedAt!.getTime());
      return NextResponse.json({ status: "confirm", msLeft });
    }
    const target = {
      hardwareId,
      userId: existing.requestUserId,
      gardenId: existing.requestGardenId ?? null,
      potId: existing.requestPotId,
      name: existing.requestName ?? hardwareId,
    };
    const problem = await claimTargetError(target);
    if (problem) return NextResponse.json({ status: "waiting", error: problem });
    const { key } = await completeClaim(target, { deliverNow: true });
    return NextResponse.json({ status: "claimed", deviceKey: key, hardwareId });
  }

  return NextResponse.json({ status: "waiting" });
}
