// API /api/gardens: list the user's gardens and create new ones
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// GET: list gardens with how many pots, plants and devices each has
export async function GET() {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;

  const gardens = await prisma.garden.findMany({
    where: { userId: gate },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { pots: true, plants: true, devices: true } } },
  });
  return NextResponse.json(gardens);
}

// Valid map coordinates (latitude and longitude)
const coordinateSchema = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
};

// Validation schema: data needed to create a garden
const schema = z.object({
  name: z.string().min(1),
  type: z.enum(["outdoor", "greenhouse", "indoor", "hydroponic"]).default("outdoor"),
  location: z.string().optional(),
  ...coordinateSchema,
  notes: z.string().optional(),
});

// POST: create a garden for the logged-in user
export async function POST(req: Request) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const userId = gate;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid garden data" }, { status: 400 });
    }
    const garden = await prisma.garden.create({
      data: { ...parsed.data, userId },
    });
    return NextResponse.json(garden, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A garden with this name already exists" },
        { status: 409 },
      );
    }
    console.error("Garden create error:", error);
    return NextResponse.json({ error: "Failed to create garden" }, { status: 500 });
  }
}
