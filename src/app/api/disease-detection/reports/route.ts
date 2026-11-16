// API /api/disease-detection/reports: the user's past diagnoses, page by page
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// Page size: 12 by default, never more than 50
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

// GET: list diagnoses (filter by ?plantId= or ?potId=, page with ?cursor=)
export async function GET(req: Request) {
  // Auth check: only logged-in users; results are always their own
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const params = new URL(req.url).searchParams;
  const plantId = params.get("plantId") || undefined;
  const potId = params.get("potId") || undefined;
  const cursor = params.get("cursor") || undefined;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit")) || DEFAULT_LIMIT));

  if (plantId) {
    const plant = await prisma.plant.findFirst({ where: { id: plantId, userId: gate }, select: { id: true } });
    if (!plant) return NextResponse.json({ error: "Plant not found" }, { status: 404 });
  }

  // Fetch one extra row to know if there is a next page
  const rows = await prisma.diseasePrediction.findMany({
    where: { userId: gate, ...(plantId ? { plantId } : {}), ...(potId ? { potId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      gardenId: true,
      potId: true,
      plantId: true,
      predictedDisease: true,
      className: true,
      confidence: true,
      createdAt: true,
      pot: { select: { label: true } },
      garden: { select: { name: true } },
      plant: { select: { commonName: true } },
    },
  });
  const items = rows.slice(0, limit).map((report) => ({
    ...report,
    healthy: isHealthy(report.className, report.predictedDisease),
    imageUrl: `/api/disease-detection/images/${report.id}`,
  }));
  const nextCursor = rows.length > limit ? items[items.length - 1].id : null;
  const total = cursor ? undefined : await prisma.diseasePrediction.count({ where: { userId: gate, ...(plantId ? { plantId } : {}), ...(potId ? { potId } : {}) } });
  return NextResponse.json({ items, nextCursor, total });
}

// True when the AI label says the leaf is healthy
function isHealthy(className: string | null, disease: string) {
  return `${className ?? ""} ${disease}`.toLowerCase().includes("healthy");
}
