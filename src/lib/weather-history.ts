// Saves weather readings for each garden so they can be shown in charts later
import { prisma } from "@/lib/db";
import type { WeatherResult } from "@/lib/weather";

// Save at most one weather snapshot per garden every 10 minutes by default
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

// Snapshot interval from env (seconds), or the default
function intervalMs() {
  const seconds = Number(process.env.WEATHER_SNAPSHOT_INTERVAL_SECONDS ?? "600");
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_INTERVAL_MS;
}

// Saves fresh garden weather if enough time passed since the last save
export async function persistGardenWeatherSnapshot(gardenId: string, weather: WeatherResult) {
  if (weather.isStale) return null;
  const latest = await prisma.weatherSnapshot.findFirst({
    where: { gardenId }, orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true },
  });
  if (latest && Date.now() - latest.fetchedAt.getTime() < intervalMs()) return null;
  return prisma.weatherSnapshot.create({
    data: {
      gardenId, temperature: weather.current.temp, humidity: weather.current.humidity,
      precipitation: weather.current.rain, rainProbability: weather.current.rainProb,
      windSpeed: weather.current.windSpeed, condition: weather.current.description,
      uvIndex: weather.current.uvIndex, provider: "open-meteo", observedAt: new Date(weather.fetchedAt),
    },
  });
}
