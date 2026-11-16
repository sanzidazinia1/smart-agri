// API /api/gardens/[id]: read, update or delete one garden
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// Validation schema: garden fields that may be changed
const schema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["outdoor", "greenhouse", "indoor", "hydroponic"]).optional(),
  location: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
  notes: z.string().optional(),
});

// GET: return one of the user's gardens with its counts
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;

  const garden = await prisma.garden.findFirst({
    where: { id, userId: gate },
    include: { _count: { select: { pots: true, plants: true, devices: true } } },
  });
  if (!garden) {
    return NextResponse.json({ error: "Garden not found" }, { status: 404 });
  }
  return NextResponse.json(garden);
}

// PATCH: update a garden's details
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  // Lat and lng must come together, never just one
  const hasLat = Object.prototype.hasOwnProperty.call(parsed.data, "lat");
  const hasLng = Object.prototype.hasOwnProperty.call(parsed.data, "lng");
  if (hasLat !== hasLng) {
    return NextResponse.json(
      { error: "Latitude and longitude must be updated together" },
      { status: 400 },
    );
  }

  // DB write: userId in the filter means only the owner can update it
  const result = await prisma.garden.updateMany({
    where: { id, userId: gate },
    data: parsed.data,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Garden not found" }, { status: 404 });
  }
  const garden = await prisma.garden.findFirst({ where: { id, userId: gate } });
  return NextResponse.json(garden);
}

// DELETE: remove one of the user's gardens
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;

  const result = await prisma.garden.deleteMany({ where: { id, userId: gate } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Garden not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
