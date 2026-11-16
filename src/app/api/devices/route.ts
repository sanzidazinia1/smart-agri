// API /api/devices: list your ESP32 boards and register new ones
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { otherDeviceOnPot } from "@/lib/device-claim";
import { generateDeviceKey } from "@/lib/device-key";
import { getDeviceConnectionStatus } from "@/lib/device-status";

// GET: list the user's devices with their pots and online/offline status
export async function GET(req: Request) {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { searchParams } = new URL(req.url);
  const gardenId = searchParams.get("gardenId") || undefined;
  const devices = await prisma.device.findMany({
    where: {
      userId: gate,
      ...(gardenId ? { gardenId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      garden: { select: { name: true } },
      potMappings: { select: { port: true, pot: { select: { id: true, label: true } } }, orderBy: { port: "asc" } },
    },
    // Never expose apiKeyHash.
    omit: { apiKeyHash: true },
  });
  const now = new Date();
  return NextResponse.json(devices.map(({ potMappings, ...device }) => ({
    ...device,
    // Each connected pot with the board port it's on (1 for single-pot boards).
    pots: potMappings.map((mapping) => ({ ...mapping.pot, port: mapping.port })),
    status: getDeviceConnectionStatus(device.lastSeenAt, now),
  })));
}

// Validation schema: data needed to register a new device
const schema = z.object({
  gardenId: z.string().min(1),
  hardwareId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z
    .enum([
      "esp32_node",
      "dht22",
      "dht11",
      "soil_moisture",
      "rain",
      "ldr",
      "water_flow",
      "solenoid_valve",
      "camera",
    ])
    .default("esp32_node"),
  // Connect the new device to this pot (same garden) as part of registering it.
  potId: z.string().trim().min(1).optional(),
});

// POST: register a device and return its secret key once (only the hash is saved)
export async function POST(req: Request) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const userId = gate;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid device data" }, { status: 400 });
    }
    // Make sure the garden belongs to this user
    const garden = await prisma.garden.findFirst({
      where: { id: parsed.data.gardenId, userId },
    });
    if (!garden) {
      return NextResponse.json({ error: "Garden not found" }, { status: 404 });
    }

    const { potId, ...deviceData } = parsed.data;
    if (potId) {
      const pot = await prisma.pot.findFirst({
        where: { id: potId, userId, gardenId: deviceData.gardenId },
        select: { id: true },
      });
      if (!pot) {
        return NextResponse.json({ error: "Pot not found in this garden" }, { status: 400 });
      }
      // A pot can only have one device
      const occupant = await otherDeviceOnPot(potId);
      if (occupant) {
        return NextResponse.json({ error: `This pot already has a device (${occupant}). Disconnect it first.` }, { status: 409 });
      }
    }
    const { plain, hash } = generateDeviceKey();
    // DB write: create the device and link it to the pot together
    const device = await prisma.$transaction(async (tx) => {
      const created = await tx.device.create({
        data: { ...deviceData, userId, apiKeyHash: hash },
        omit: { apiKeyHash: true },
      });
      if (potId) await tx.devicePotMapping.create({ data: { deviceId: created.id, potId, port: 1 } });
      return created;
    });

    // Plaintext key is returned exactly once — store it on the ESP32.
    return NextResponse.json({ device, deviceKey: plain }, { status: 201 });
  } catch (error) {
    // P2002 = unique clash: this hardware ID is already registered
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A device with this hardware ID already exists" },
        { status: 409 },
      );
    }
    console.error("Device create error:", error);
    return NextResponse.json({ error: "Failed to create device" }, { status: 500 });
  }
}
