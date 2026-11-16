// Saves/loads each user's Disease AI choice; API keys stay encrypted
import type { AiProvider } from "@prisma/client";
import { prisma } from "@/lib/db";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { PROVIDER_INFO, type OnlineProvider } from "@/lib/ai-vision";

// Which AI engine runs a diagnosis, plus its key and model when online
export type DiseaseEngine =
  | { provider: "LOCAL" }
  | { provider: OnlineProvider; apiKey: string; model: string; fallbackToLocal: boolean };

// Picks the AI engine for this user and decrypts its key (server only)
export async function getDiseaseEngine(userId: string): Promise<DiseaseEngine> {
  const row = await prisma.aiSettings.findUnique({ where: { userId } });
  if (!row || row.provider === "LOCAL") return { provider: "LOCAL" };
  const sealed = row.provider === "GEMINI" ? row.geminiKeySealed : row.groqKeySealed;
  const apiKey = sealed ? openSecret(sealed) : null;
  // No usable key (e.g. AUTH_SECRET changed): use the local model.
  if (!apiKey) return { provider: "LOCAL" };
  const model = (row.provider === "GEMINI" ? row.geminiModel : row.groqModel) || PROVIDER_INFO[row.provider].defaultModel;
  return { provider: row.provider, apiKey, model, fallbackToLocal: row.fallbackToLocal };
}

// Hides a saved key, showing only its last 4 characters
const mask = (sealed: string | null) => {
  if (!sealed) return null;
  const key = openSecret(sealed);
  return key ? `••••${key.slice(-4)}` : "saved (can't be read — enter it again)";
};

// Settings safe to send to the browser: no real keys, only masked ones
export async function getAiSettingsView(userId: string) {
  const row = await prisma.aiSettings.findUnique({ where: { userId } });
  return {
    provider: (row?.provider ?? "LOCAL") as AiProvider,
    fallbackToLocal: row?.fallbackToLocal ?? true,
    gemini: { key: mask(row?.geminiKeySealed ?? null), model: row?.geminiModel || PROVIDER_INFO.GEMINI.defaultModel },
    groq: { key: mask(row?.groqKeySealed ?? null), model: row?.groqModel || PROVIDER_INFO.GROQ.defaultModel },
  };
}

// Encrypts an API key before it is saved in the database
export function sealKey(key: string) {
  return sealSecret(key.trim());
}

// Returns the user's saved key for a provider (used by "Test"), or null
export async function savedKey(userId: string, provider: OnlineProvider) {
  const row = await prisma.aiSettings.findUnique({ where: { userId } });
  const sealed = provider === "GEMINI" ? row?.geminiKeySealed : row?.groqKeySealed;
  return sealed ? openSecret(sealed) : null;
}
