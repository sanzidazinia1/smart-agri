// API /api/disease-detection/health: which disease AI is in use and is it ready
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { aiServiceHealth, localAiAvailable } from "@/lib/ai";
import { getDiseaseEngine } from "@/lib/ai-settings";
import { PROVIDER_INFO } from "@/lib/ai-vision";

// GET: report the AI status (ready, demo, offline or unavailable)
export async function GET() {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  // The engine the user picked in Settings: local model, Gemini or Groq
  const engine = await getDiseaseEngine(gate);
  if (engine.provider !== "LOCAL") {
    // Online AI: ready as long as a key is saved (the local model is the backup).
    return NextResponse.json({
      status: "ready" as const,
      engine: engine.provider.toLowerCase(),
      engineName: PROVIDER_INFO[engine.provider].name,
      model: engine.model,
    });
  }
  // Live site without a hosted AI service: only the online AIs can diagnose.
  if (!localAiAvailable()) return NextResponse.json({ status: "unavailable" as const, engine: "local" });
  // Ask the local Python AI service if it is up
  const health = await aiServiceHealth();
  if (!health) return NextResponse.json({ status: "offline" as const, engine: "local" });
  return NextResponse.json({
    status: health.status === "ready" ? ("ready" as const) : ("mock" as const),
    engine: "local",
    labels: health.labels,
  });
}
