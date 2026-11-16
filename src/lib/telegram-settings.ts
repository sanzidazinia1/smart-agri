import "server-only";
// Picks the Telegram bot for a user: their own from Settings, else the .env one
import { prisma } from "@/lib/db";
import { openSecret } from "@/lib/secret-box";
import { getTelegramConfig, sendTelegramText, type TelegramConfig } from "@/lib/telegram";

// Returns the user's Telegram bot and chat, or null if alerts are off
export async function getUserTelegramConfig(userId: string): Promise<{ config: TelegramConfig; source: "app" | "env" } | null> {
  const settings = await prisma.telegramSettings.findUnique({ where: { userId }, select: { botTokenCipher: true, chatId: true, paused: true } });
  // Paused in Settings: no alerts at all (not even via the .env bot)
  if (settings?.paused) return null;
  if (settings?.chatId) {
    const botToken = openSecret(settings.botTokenCipher);
    if (botToken) return { config: { botToken, chatId: settings.chatId }, source: "app" };
  }
  const env = getTelegramConfig();
  return env ? { config: env, source: "env" } : null;
}

// Sends a message with the user's bot; fails with "configuration" if none
export async function sendTelegramForUser(userId: string, text: string) {
  const resolved = await getUserTelegramConfig(userId);
  if (!resolved) return { ok: false as const, reason: "configuration" as const };
  return sendTelegramText(text, { config: resolved.config });
}
