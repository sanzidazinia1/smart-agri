// API /api/iot/commands: ESP32 polls here for pump commands and confirms them
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDevice } from "@/lib/device-auth";
import { acknowledgePumpCommand, claimDeviceCommands } from "@/lib/device-commands";
import { prisma } from "@/lib/db";
import { DEVICE_ACTIONS, isActionLive } from "@/lib/device-actions";

export const runtime = "nodejs";

// Validation schema: board says a pump command was received or carried out
const ackSchema = z.object({
  deviceId: z.string().min(1).optional(),
  hardwareId: z.string().min(1).optional(),
  commandId: z.string().min(1),
  kind: z.enum(["delivery", "execution"]).default("execution"),
  success: z.boolean().default(true),
  error: z.string().optional(),
});

// Validation schema: board confirms a remote action (restart, reset...)
const actionAckSchema = z.object({
  hardwareId: z.string().min(1).optional(),
  action: z.enum(DEVICE_ACTIONS),
  kind: z.literal("action"),
});

// GET: give the board its waiting pump commands, any action, and port count
export async function GET(req: Request) {
  // Device auth: the board must send a valid device key
  const device = await authenticateDevice(req);
  if (!device) {
    return NextResponse.json({ error: "Invalid device or key" }, { status: 401 });
  }

  // Take this board's queued commands and find which port each pot is on
  const commands = await claimDeviceCommands(device.id);
  const links = commands.length
    ? await prisma.devicePotMapping.findMany({ where: { deviceId: device.id }, select: { potId: true, port: true } })
    : [];
  const portOf = new Map(links.map((link) => [link.potId, link.port]));

  // Remote action from the app (restart, Wi-Fi reset, sleep, factory reset)
  const pending = await prisma.device.findUnique({ where: { id: device.id }, select: { pendingAction: true, pendingActionAt: true, desiredPorts: true } });
  let action: string | null = null;
  if (pending?.pendingAction) {
    if (isActionLive(pending.pendingAction, pending.pendingActionAt)) action = pending.pendingAction;
    else await prisma.device.update({ where: { id: device.id }, data: { pendingAction: null, pendingActionAt: null } });
  }

  return NextResponse.json({
    success: true,
    action,
    // Port count set in the app; firmware 2.9+ applies it.
    ...(pending?.desiredPorts ? { ports: pending.desiredPorts } : {}),
    // port: which of the board's relays drives this pot (1 for single-pot boards).
    commands: commands.map((command) => ({ id: command.id, deviceId: command.deviceId, potId: command.potId, port: portOf.get(command.potId) ?? 1, command: command.command, mode: command.mode, sequence: command.sequence, expiresAt: command.expiresAt, status: "SENT" })),
  });
}

// POST: board confirms a remote action or a pump command result
export async function POST(req: Request) {
  // Device auth: the board must send a valid device key
  const device = await authenticateDevice(req);
  if (!device) {
    return NextResponse.json({ error: "Invalid device or key" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The board confirms a remote action just before carrying it out.
  const actionAck = actionAckSchema.safeParse(body);
  if (actionAck.success) {
    const current = await prisma.device.findUnique({ where: { id: device.id }, select: { pendingAction: true } });
    if (current?.pendingAction !== actionAck.data.action) {
      return NextResponse.json({ error: "No such action pending" }, { status: 409 });
    }
    if (actionAck.data.action === "FACTORY_RESET") {
      // Board is wiping itself: delete it so it can be added fresh
      await prisma.device.delete({ where: { id: device.id } });
    } else {
      await prisma.device.update({ where: { id: device.id }, data: { pendingAction: null, pendingActionAt: null } });
    }
    return NextResponse.json({ success: true });
  }

  const parsed = ackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid command acknowledgement" }, { status: 400 });
  }

  try {
    // Mark the pump command as delivered/done (or failed)
    const result = await acknowledgePumpCommand({
      commandId: parsed.data.commandId,
      deviceId: device.id,
      kind: parsed.data.kind,
      success: parsed.data.success,
      error: parsed.data.error,
    });
    return NextResponse.json({ success: true, command: result.command });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command not found";
    return NextResponse.json(
      { error: message },
      { status: message === "Command not found" ? 404 : 409 },
    );
  }
}
