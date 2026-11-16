// Talks to the local Python AI service that detects plant diseases from leaf photos

// AI service address; 127.0.0.1 not "localhost" to avoid IPv6 connection errors
const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");

// True if the local AI can be used (always locally; on Vercel only if URL is set)
export function localAiAvailable() {
  return Boolean(process.env.AI_SERVICE_URL) || !process.env.VERCEL;
}
// Optional secret token for a hosted AI service (/health stays public)
const AI_SERVICE_TOKEN = process.env.AI_SERVICE_TOKEN;
const authHeaders = (): Record<string, string> => (AI_SERVICE_TOKEN ? { "x-ai-token": AI_SERVICE_TOKEN } : {});

// Treatment steps grouped by type
export interface AiTreatment {
  immediate: string[];
  organic: string[];
  chemical: string[];
  prevention: string[];
}

// The diagnosis result returned by the AI for one leaf photo
export interface AiPrediction {
  disease: string;
  crop: string;
  className: string;
  confidence: number;
  severity: "low" | "medium" | "high";
  symptoms: string[];
  treatment: AiTreatment;
  recommendation: string;
  modelVersion: string;
  // Next most likely answers (within the pot's crop when known)
  alternatives?: { disease: string; className: string; confidence: number }[];
  // True when the model isn't sure (low confidence or photo doesn't match)
  uncertain?: boolean;
  // The crop the answer was limited to (the pot's plant), if any
  restrictedTo?: string | null;
  // The crop the photo looked most like before limiting, e.g. "peach"
  lookedLike?: string | null;
  // How much the photo looks like the pot's crop (0–1); low = not like it
  cropMatch?: number | null;
}

// Sends a leaf photo to the local AI service and returns its diagnosis
export async function analyzeLeafImage(
  file: Blob,
  filename = "leaf.jpg",
  // The pot's crop (e.g. "tomato"): only its diseases are considered
  crop?: string | null,
): Promise<AiPrediction> {
  const form = new FormData();
  form.append("file", file, filename);
  if (crop) form.append("crop", crop);

  // A free hosted service may be waking from sleep: allow up to a minute.
  const res = await fetch(`${AI_SERVICE_URL}/predict`, {
    method: "POST",
    body: form,
    headers: authHeaders(),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI service error (${res.status}): ${detail}`);
  }

  return (await res.json()) as AiPrediction;
}

// Checks if the local AI service is running; returns null if not
export async function aiServiceHealth(): Promise<{
  status: string;
  labels: number;
} | null> {
  try {
    const res = await fetch(`${AI_SERVICE_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { status: string; labels: number };
  } catch {
    return null;
  }
}

// Turns a diagnosis into a 0–100 health score (healthy = 100, worse = lower)
export function healthContributionFromPrediction(p: AiPrediction): number {
  const isHealthy =
    p.className.toLowerCase().includes("healthy") ||
    p.disease.toLowerCase().includes("healthy");
  if (isHealthy) return 100;

  const severityFloor = { low: 70, medium: 45, high: 20 }[p.severity] ?? 50;
  // Higher confidence in a disease => stronger penalty toward the floor.
  return Math.round(100 - (100 - severityFloor) * Math.min(p.confidence, 1));
}
