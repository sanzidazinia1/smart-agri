// API /api/gardens/[id]/alerts/resolve: mark a garden alert resolved, or undo it
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// Validation schema: which alert to resolve
const schema = z.object({ alertId: z.string().trim().min(1).max(200) });

// Shared check: logged in, valid alertId, and the garden is the user's
async function parse(req: Request, params: Promise<{ id: string }>) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "alertId is required" }, { status: 400 });

  const garden = await prisma.garden.findFirst({ where: { id, userId: gate }, select: { id: true } });
  if (!garden) return NextResponse.json({ error: "Garden not found" }, { status: 404 });

  return { userId: gate, gardenId: garden.id, alertKey: parsed.data.alertId };
}

// POST: mark the alert resolved (it comes back if the problem returns later)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const target = await parse(req, params);
  if (target instanceof NextResponse) return target;

  await prisma.alertResolution.upsert({
    where: { gardenId_alertKey: { gardenId: target.gardenId, alertKey: target.alertKey } },
    create: target,
    update: { resolvedAt: new Date() },
  });
  return NextResponse.json({ resolved: true });
}

// DELETE: undo the resolve so the alert shows again
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const target = await parse(req, params);
  if (target instanceof NextResponse) return target;

  await prisma.alertResolution.deleteMany({
    where: { gardenId: target.gardenId, alertKey: target.alertKey, userId: target.userId },
  });
  return NextResponse.json({ resolved: false });
}
