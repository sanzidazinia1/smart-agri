// API /api/plants: list the user's plants and add a plant to a pot
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { GROWTH_STAGES } from "@/lib/growth-stages";

// GET: list plants (optionally for one garden) with their garden and pot
export async function GET(req: Request) {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const { searchParams } = new URL(req.url);
  const gardenId = searchParams.get("gardenId") || undefined;

  const plants = await prisma.plant.findMany({
    where: { userId: gate, ...(gardenId ? { gardenId } : {}) },
    orderBy: { updatedAt: "desc" },
    include: {
      garden: { select: { name: true } },
      pot: {
        select: {
          id: true,
          label: true,
          soilType: true,
          moistureOnThreshold: true,
          moistureOffThreshold: true,
        },
      },
    },
  });
  return NextResponse.json(plants);
}

// Validation schema: data needed to add a plant
const schema = z.object({
  gardenId: z.string().min(1),
  potId: z.string().min(1),
  commonName: z.string().min(1),
  scientificName: z.string().optional(),
  variety: z.string().optional(),
  plantedAt: z.string().datetime().optional(),
  growthStage: z
    .enum(GROWTH_STAGES)
    .default("seedling"),
  notes: z.string().optional(),
});

// POST: add a plant to an empty pot the user owns
export async function POST(req: Request) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const userId = gate;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid plant data" }, { status: 400 });
    }
    const garden = await prisma.garden.findFirst({
      where: { id: parsed.data.gardenId, userId },
    });
    if (!garden) {
      return NextResponse.json({ error: "Garden not found" }, { status: 404 });
    }
    // The pot must be in that garden and not already have a plant
    const pot = await prisma.pot.findFirst({
      where: {
        id: parsed.data.potId,
        gardenId: parsed.data.gardenId,
        userId,
      },
      include: { plant: { select: { id: true } } },
    });
    if (!pot) {
      return NextResponse.json(
        { error: "Pot not found for selected garden" },
        { status: 400 },
      );
    }
    if (pot.plant) {
      return NextResponse.json(
        { error: "Pot already has a plant" },
        { status: 409 },
      );
    }

    const { plantedAt, ...rest } = parsed.data;
    const plant = await prisma.plant.create({
      data: {
        ...rest,
        userId,
        plantedAt: plantedAt ? new Date(plantedAt) : null,
      },
    });
    return NextResponse.json(plant, { status: 201 });
  } catch (error) {
    // P2002 = unique clash: someone added a plant to this pot at the same time
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Pot already has a plant" },
        { status: 409 },
      );
    }
    console.error("Plant create error:", error);
    return NextResponse.json({ error: "Failed to create plant" }, { status: 500 });
  }
}
