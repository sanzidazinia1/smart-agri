// API /api/settings/ai: choose the disease AI and save its API keys (encrypted)
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getAiSettingsView, sealKey } from "@/lib/ai-settings";
import { localAiAvailable } from "@/lib/ai";

// A model name: only letters, numbers and . / : - _
const model = z.string().trim().max(100).regex(/^[\w./:-]*$/, "That model name has unexpected characters.");
// Validation schema: AI settings that may be changed (no extra keys)
const schema = z
  .object({
    provider: z.enum(["LOCAL", "GEMINI", "GROQ"]).optional(),
    fallbackToLocal: z.boolean().optional(),
    // A new key to save; "" removes the saved one; omitted = keep.
    geminiKey: z.string().trim().max(300).optional(),
    geminiModel: model.optional(),
    groqKey: z.string().trim().max(300).optional(),
    groqModel: model.optional(),
  })
  .strict();

// GET: current AI settings (keys are never sent back to the browser)
export async function GET() {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ ...(await getAiSettingsView(gate)), localAvailable: localAiAvailable() });
}

// PUT: save the chosen engine, models and keys
export async function PUT(req: Request) {
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  const input = parsed.data;

  const current = await prisma.aiSettings.findUnique({ where: { userId: gate } });
  // Only change fields that were sent; keys are encrypted with sealKey
  const data = {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.fallbackToLocal !== undefined ? { fallbackToLocal: input.fallbackToLocal } : {}),
    ...(input.geminiKey !== undefined ? { geminiKeySealed: input.geminiKey ? sealKey(input.geminiKey) : null } : {}),
    ...(input.geminiModel !== undefined ? { geminiModel: input.geminiModel || null } : {}),
    ...(input.groqKey !== undefined ? { groqKeySealed: input.groqKey ? sealKey(input.groqKey) : null } : {}),
    ...(input.groqModel !== undefined ? { groqModel: input.groqModel || null } : {}),
  };
  // An online engine needs its key.
  const provider = input.provider ?? current?.provider ?? "LOCAL";
  const hasGemini = data.geminiKeySealed !== undefined ? Boolean(data.geminiKeySealed) : Boolean(current?.geminiKeySealed);
  const hasGroq = data.groqKeySealed !== undefined ? Boolean(data.groqKeySealed) : Boolean(current?.groqKeySealed);
  if ((provider === "GEMINI" && !hasGemini) || (provider === "GROQ" && !hasGroq)) {
    return NextResponse.json({ error: `Add your ${provider === "GEMINI" ? "Gemini" : "Groq"} API key first.` }, { status: 400 });
  }

  // DB write: create or update this user's AI settings
  await prisma.aiSettings.upsert({ where: { userId: gate }, create: { userId: gate, ...data }, update: data });
  return NextResponse.json({ ...(await getAiSettingsView(gate)), localAvailable: localAiAvailable() });
}
