// Checks that a request really comes from a registered board (via its device key)
import { prisma } from "@/lib/db";
import { hashDeviceKey } from "@/lib/device-key";

// Returns the board if its key matches its hardware ID, otherwise null
export async function authenticateDevice(req: Request) {
  const key = req.headers.get("x-device-key");
  if (!key) return null;

  // The board's hardware ID comes from the URL or, if missing, the JSON body
  const { searchParams } = new URL(req.url);
  const hardwareIdFromQuery = searchParams.get("deviceId") ?? searchParams.get("hardwareId");

  let bodyHardwareId: string | undefined;
  if (!hardwareIdFromQuery && req.method !== "GET") {
    try {
      const clone = req.clone();
      const body = (await clone.json()) as { deviceId?: string; hardwareId?: string };
      bodyHardwareId = body.deviceId ?? body.hardwareId;
    } catch {
      bodyHardwareId = undefined;
    }
  }

  const hardwareId = hardwareIdFromQuery ?? bodyHardwareId;
  if (!hardwareId) return null;

  const device = await prisma.device.findUnique({
    where: { hardwareId },
    select: {
      id: true,
      userId: true,
      gardenId: true,
      hardwareId: true,
      apiKeyHash: true,
    },
  });

  // Compare hashes; the real key is never stored
  if (!device || device.apiKeyHash !== hashDeviceKey(key)) return null;
  return device;
}
