// API /api/devices/pairing: list new boards waiting to be claimed, and claim one
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { claimTargetError, completeClaim } from "@/lib/device-claim";
import {
  CONFIRM_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  PAIRING_VISIBLE_MS,
  isConfirmPending,
  isPairingVisible,
  normalizePairingCode,
  pairingCodesMatch,
} from "@/lib/device-pairing";

// GET: list unclaimed boards, or with ?hardwareId= show your claim's progress
export async function GET(req: Request) {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;

  const hardwareId = new URL(req.url).searchParams.get("hardwareId");
  // Progress of this user's claim: claimed, waiting for button, or available
  if (hardwareId) {
    const pairing = await prisma.devicePairing.findUnique({ where: { hardwareId } });
    if (pairing?.claimedAt && pairing.claimedByUserId === gate) {
      const device = pairing.deviceId
        ? await prisma.device.findUnique({ where: { id: pairing.deviceId }, select: { id: true, name: true, gardenId: true } })
        : null;
      return NextResponse.json({ state: "claimed", device });
    }
    if (pairing && pairing.requestUserId === gate && isConfirmPending(pairing.confirmRequestedAt)) {
      const msLeft = CONFIRM_WINDOW_MS - (Date.now() - pairing.confirmRequestedAt!.getTime());
      return NextResponse.json({ state: "waiting-button", msLeft });
    }
    if (pairing && !pairing.claimedAt && isPairingVisible(pairing.lastSeenAt)) {
      return NextResponse.json({ state: "available" });
    }
    return NextResponse.json({ state: "not-found" });
  }

  // Boards seen recently that nobody has claimed (pairing codes are not sent)
  const since = new Date(Date.now() - PAIRING_VISIBLE_MS);
  const pairings = await prisma.devicePairing.findMany({
    where: { claimedAt: null, lastSeenAt: { gte: since } },
    orderBy: { lastSeenAt: "desc" },
    select: { hardwareId: true, firmware: true, lastSeenAt: true, createdAt: true },
    take: 50,
  });
  // Mark boards this user owned before; never reveal other users' devices.
  const mine = await prisma.device.findMany({
    where: { userId: gate, hardwareId: { in: pairings.map((pairing) => pairing.hardwareId) } },
    select: { hardwareId: true, name: true },
  });
  const mineByHardware = new Map(mine.map((device) => [device.hardwareId, device.name]));
  return NextResponse.json(
    pairings.map((pairing) => ({ ...pairing, existingName: mineByHardware.get(pairing.hardwareId) ?? null })),
  );
}

// Validation schema: a claim request (code is optional; no code = BOOT button)
const claimSchema = z.object({
  hardwareId: z.string().trim().min(1),
  pairingCode: z.string().trim().optional(),
  gardenId: z.string().trim().min(1).optional(),
  potId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(80),
});

// POST: claim a board with its 6-digit code, or wait for its BOOT button
export async function POST(req: Request) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const userId = gate;

  const parsed = claimSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid claim" }, { status: 400 });
  const { hardwareId, gardenId, potId, name } = parsed.data;

  const pairing = await prisma.devicePairing.findUnique({ where: { hardwareId } });
  if (!pairing || pairing.claimedAt || !isPairingVisible(pairing.lastSeenAt)) {
    return NextResponse.json(
      { error: "That board isn't waiting to be claimed. Make sure it's powered on and connected to Wi-Fi." },
      { status: 404 },
    );
  }

  // Check the chosen garden/pot are valid before claiming
  const target = { hardwareId, userId, gardenId: gardenId ?? null, potId: potId ?? null, name };
  const problem = await claimTargetError(target);
  if (problem) return NextResponse.json({ error: problem }, { status: problem.includes("another account") ? 409 : 400 });

  // No code: save the request; the board finishes it via /api/iot/pair on BOOT
  if (!parsed.data.pairingCode) {
    await prisma.devicePairing.update({
      where: { hardwareId },
      data: {
        confirmRequestedAt: new Date(),
        requestUserId: userId,
        requestGardenId: gardenId ?? null,
        requestPotId: potId ?? null,
        requestName: name,
      },
    });
    return NextResponse.json({ state: "waiting-button", msLeft: CONFIRM_WINDOW_MS }, { status: 202 });
  }

  // Pairing code path: check the code, with a limit on wrong guesses
  const code = normalizePairingCode(parsed.data.pairingCode);
  if (!code) return NextResponse.json({ error: "Enter the 6-digit code shown by the board." }, { status: 400 });
  if (pairing.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many wrong codes. Claim with the board's BOOT button instead." },
      { status: 429 },
    );
  }
  if (!pairingCodesMatch(pairing.pairingCode, code)) {
    await prisma.devicePairing.update({ where: { hardwareId }, data: { failedAttempts: { increment: 1 } } });
    const left = MAX_FAILED_ATTEMPTS - pairing.failedAttempts - 1;
    return NextResponse.json(
      { error: left > 0 ? `That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code doesn't match. Use the board's BOOT button instead." },
      { status: 400 },
    );
  }

  // Code matched: create the device for this user
  const { device } = await completeClaim(target, { deliverNow: false });
  return NextResponse.json({ state: "claimed", device }, { status: 201 });
}
