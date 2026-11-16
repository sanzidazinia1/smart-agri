import "server-only";
// Sends Telegram messages and helps connect a user's bot from Settings

// Telegram API address, request timeout and max message length
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TELEGRAM_TEXT_LENGTH = 4_096;

// Any function that works like fetch (tests pass a fake one)
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// The bot token and chat that messages go to
export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

// Result of sending a message: ok, or the reason it failed
export type TelegramSendResult =
  | { ok: true; providerMessageId?: string }
  | {
      ok: false;
      reason: "configuration" | "http" | "api" | "network" | "timeout" | "invalid-message";
      providerCode?: string;
    };

// The parts of Telegram's reply we read
type TelegramApiResponse = {
  ok?: unknown;
  result?: { message_id?: unknown };
  error_code?: unknown;
};

// Extra options for sending (mainly for tests)
export type SendTelegramTextOptions = {
  // Bot and chat to use (default: from env vars)
  config?: TelegramConfig | null;
  // For tests: a fake fetch
  fetchImpl?: FetchLike;
  // For tests: a custom timeout
  timeoutMs?: number;
};

// True if the text looks like a Telegram bot token
function isValidBotToken(value: string) {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(value);
}

// True if the text looks like a chat ID or @channel name
function isValidChatId(value: string) {
  return /^-?\d+$/.test(value) || /^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(value);
}

// Reads the bot token and chat ID from env vars; null if missing or invalid
export function getTelegramConfig(
  env: { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string } = process.env as {
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
  },
): TelegramConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();

  if (!botToken || !chatId || !isValidBotToken(botToken) || !isValidChatId(chatId)) {
    return null;
  }

  return { botToken, chatId };
}

// True if the error came from our timeout cancelling the request
function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

// Sends a text message to Telegram and returns ok or a safe failure reason
export async function sendTelegramText(
  text: string,
  options: SendTelegramTextOptions = {},
): Promise<TelegramSendResult> {
  if (!text.trim() || text.length > MAX_TELEGRAM_TEXT_LENGTH) {
    return { ok: false, reason: "invalid-message" };
  }

  const config = options.config ?? getTelegramConfig();
  if (!config || !isValidBotToken(config.botToken) || !isValidChatId(config.chatId)) {
    return { ok: false, reason: "configuration" };
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${TELEGRAM_API_BASE_URL}/bot${config.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: config.chatId, text }),
        signal: controller.signal,
      },
    );

    let payload: TelegramApiResponse | null = null;
    try {
      payload = (await response.json()) as TelegramApiResponse;
    } catch {
      payload = null;
    }

    if (!response.ok) return { ok: false, reason: "http", providerCode: `HTTP_${response.status}` };
    if (payload?.ok !== true) {
      const errorCode = typeof payload?.error_code === "number" ? payload.error_code : undefined;
      return { ok: false, reason: "api", providerCode: errorCode ? `API_${errorCode}` : "API" };
    }
    const messageId = payload.result?.message_id;
    return { ok: true, providerMessageId: typeof messageId === "number" || typeof messageId === "string" ? String(messageId) : undefined };
  } catch (error) {
    return { ok: false, reason: isAbortError(error) ? "timeout" : "network" };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Connecting a bot from the Settings page ----------

// Quick format check for a bot token typed into Settings
export function looksLikeBotToken(value: string) {
  return isValidBotToken(value.trim());
}

// Result of a simple Telegram API call
type TelegramCallResult<T> = { ok: true; result: T } | { ok: false; status: number; description?: string };

// Calls a Telegram API method, retrying once if there was no answer
async function callTelegram<T>(token: string, method: string, fetchImpl: FetchLike = fetch): Promise<TelegramCallResult<T>> {
  const first = await callTelegramOnce<T>(token, method, fetchImpl);
  // status 0 = no answer (network/timeout), so try once more
  if (first.ok || first.status !== 0) return first;
  return callTelegramOnce<T>(token, method, fetchImpl);
}

// Calls a Telegram API method once, with a timeout
async function callTelegramOnce<T>(token: string, method: string, fetchImpl: FetchLike): Promise<TelegramCallResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${TELEGRAM_API_BASE_URL}/bot${token}/${method}`, { signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!response.ok || payload?.ok !== true) return { ok: false, status: response.status, description: payload?.description };
    return { ok: true, result: payload.result as T };
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
    console.warn(
      `[telegram] ${method} failed:`,
      isAbortError(error) ? `timeout after ${DEFAULT_TIMEOUT_MS}ms` : (cause?.code ?? cause?.message ?? (error as Error)?.message ?? error),
    );
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

// Checks a bot token with Telegram and returns the bot's @username
export async function getTelegramBot(token: string, fetchImpl?: FetchLike) {
  const response = await callTelegram<{ username?: string; first_name?: string }>(token, "getMe", fetchImpl);
  if (!response.ok) return { ok: false as const, reason: response.status === 0 ? ("network" as const) : ("invalid-token" as const) };
  return { ok: true as const, username: response.result.username ?? "", name: response.result.first_name ?? "" };
}

// Finds the chat of the last person who messaged the bot, so no chat ID is typed
export async function findTelegramChat(token: string, fetchImpl?: FetchLike) {
  type Update = { message?: { chat?: { id?: number; type?: string; first_name?: string; username?: string; title?: string } } };
  const response = await callTelegram<Update[]>(token, "getUpdates", fetchImpl);
  if (!response.ok) return { ok: false as const, reason: response.status === 409 ? ("webhook" as const) : ("error" as const) };
  const chats = response.result.map((update) => update.message?.chat).filter((chat) => chat?.id != null);
  const chat = chats[chats.length - 1];
  if (!chat) return { ok: false as const, reason: "no-messages" as const };
  return { ok: true as const, chatId: String(chat.id), chatName: chat.username ? `@${chat.username}` : (chat.first_name ?? chat.title ?? "Telegram chat") };
}
