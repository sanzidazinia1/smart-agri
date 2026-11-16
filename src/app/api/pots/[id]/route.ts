// API /api/pots/[id]: edit or delete one pot (watering settings: /irrigation)
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// Validation schema: pot fields that may be changed (no extra keys)
const schema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    soilType: z.enum(["loam", "clay", "sandy", "silt", "peat", "potting_mix"]).optional(),
    sizeCm: z.number().positive().max(1000).nullable().optional(),
    position: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

// PATCH: update a pot's name, soil, size or position
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pot update" }, { status: 400 });
  }
  const data = { ...parsed.data, position: parsed.data.position === "" ? null : parsed.data.position };

  try {
    const result = await prisma.pot.updateMany({ where: { id, userId: gate }, data });
    if (result.count === 0) {
      return NextResponse.json({ error: "Pot not found" }, { status: 404 });
    }
  } catch (error) {
    // P2002 = another pot in the garden already has this name
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: `A pot named "${parsed.data.label}" already exists in this garden.` },
        { status: 409 },
      );
    }
    console.error("Pot update error:", error);
    return NextResponse.json({ error: "Failed to update pot" }, { status: 500 });
  }
  return NextResponse.json(await prisma.pot.findUnique({ where: { id } }));
}

// DELETE: remove one of the user's pots
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const result = await prisma.pot.deleteMany({ where: { id, userId: gate } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Pot not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
