// Server helper that fetches the latest sensor readings for the dashboard.
import { prisma } from "@/lib/db";
import type { Metric } from "@prisma/client";

// Newest value of each sensor reading (null = no reading yet)
export interface LatestEnvironment {
  moisture: number | null;
  temperature: number | null;
  humidity: number | null;
  light: number | null;
  rain: number | null;
  recordedAt: Date | null;
}

// The sensor metrics we look up
const ENV_METRICS: Metric[] = [
  "soil_moisture",
  "temperature",
  "humidity",
  "light",
  "rain",
];

// Gets the newest value of each metric for a user (optionally one garden)
export async function getLatestEnvironment(
  userId: string,
  gardenId?: string,
): Promise<LatestEnvironment> {
  const rows = await Promise.all(
    ENV_METRICS.map((metric) =>
      prisma.reading.findFirst({
        where: { userId, metric, ...(gardenId ? { gardenId } : {}) },
        orderBy: { recordedAt: "desc" },
        select: { value: true, recordedAt: true },
      }),
    ),
  );

  // Use the newest time among all metrics as the "last updated" time
  const [moisture, temperature, humidity, light, rain] = rows;
  const recordedAt = rows
    .map((r) => r?.recordedAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    moisture: moisture?.value ?? null,
    temperature: temperature?.value ?? null,
    humidity: humidity?.value ?? null,
    light: light?.value ?? null,
    rain: rain?.value ?? null,
    recordedAt: recordedAt ?? null,
  };
}
