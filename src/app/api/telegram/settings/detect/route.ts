// API /api/telegram/settings/detect: find the chat after the user presses Start
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { openSecret } from "@/lib/secret-box";

export const runtime = "nodejs";

// POST: look up the user's chat with their bot and save it
export async function POST() {
  // Auth check: only logged-in users
  const gate = await requireUser();
  if (gate instanceof NextResponse) return gate;
  const settings = await prisma.telegramSettings.findUnique({ where: { userId: gate } });
  const token = settings ? openSecret(settings.botTokenCipher) : null;
  if (!settings || !token) return NextResponse.json({ error: "Connect your bot first." }, { status: 400 });

  const { findTelegramChat } = await import("@/lib/telegram");
  const chat = await findTelegramChat(token);
  if (!chat.ok) {
    const message =
      chat.reason === "no-messages"
        ? `No message yet — open @${settings.botUsername} in Telegram, press Start, then try again.`
        : chat.reason === "webhook"
          ? "This bot has a webhook set, so its messages can't be read here. Use a new bot from @BotFather."
          : "Couldn't reach Telegram — try again in a moment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  await prisma.telegramSettings.update({ where: { userId: gate }, data: { chatId: chat.chatId, chatName: chat.chatName } });
  return NextResponse.json({ chatName: chat.chatName });
}
