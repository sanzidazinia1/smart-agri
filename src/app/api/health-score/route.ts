// API /api/health-score: crop health score (0–100) from sensors and disease scans
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { computeHealthScore } from "@/lib/health-score";
import { getLatestEnvironment } from "@/server/readings";

// GET: combine latest readings with the last disease result into one score
export async function GET(req: Request) {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const userId = gate;

  try {
    const { searchParams } = new URL(req.url);
    const gardenId = searchParams.get("gardenId") || undefined;

    const [env, latestDisease] = await Promise.all([
      getLatestEnvironment(userId, gardenId),
      prisma.diseaseReport.findFirst({
        where: { userId },
        orderBy: { detectedAt: "desc" },
        select: { healthScoreContribution: true },
      }),
    ]);

    // No data at all yet: return an empty score
    if (env.recordedAt === null && !latestDisease) {
      return NextResponse.json({
        healthScore: 0,
        message: "No device data available yet",
        factors: { moisture: 0, temperature: 0, humidity: 0, diseaseScore: 100 },
      });
    }

    const result = computeHealthScore({
      moisture: env.moisture,
      temperature: env.temperature,
      humidity: env.humidity,
      diseaseScore: latestDisease?.healthScoreContribution ?? 100,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Health score error:", error);
    return NextResponse.json(
      { error: "Failed to calculate health score" },
      { status: 500 },
    );
  }
}
