import { validateWebhookSecret, isAllowedSender } from "./lib/validation";
import { processMessage } from "./agent";
import { sendMessage, answerCallbackQuery, editMessageText } from "./tools/reply";
import { getSelectedProvider, setSelectedProvider } from "./lib/model_config";
import { availableProviders } from "./providers";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!;
const ALLOWED_IDS = (process.env.ALLOWED_CHAT_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = Number(process.env.PORT ?? 3000);

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

// Telegram retries webhooks it considers failed; on Cloud Run (cold starts,
// synchronous processing) that can re-deliver an update we already handled.
const MAX_TRACKED_UPDATES = 500;
const seenUpdateIds = new Set<number>();
const seenUpdateOrder: number[] = [];

function isDuplicate(updateId: number): boolean {
  if (seenUpdateIds.has(updateId)) return true;
  seenUpdateIds.add(updateId);
  seenUpdateOrder.push(updateId);
  if (seenUpdateOrder.length > MAX_TRACKED_UPDATES) {
    seenUpdateIds.delete(seenUpdateOrder.shift()!);
  }
  return false;
}

export async function handleWebhook(req: Request): Promise<Response> {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!validateWebhookSecret(secret, WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    // Malformed body: acknowledge so Telegram doesn't retry-loop it
    return new Response("OK");
  }

  if (typeof update.update_id === "number" && isDuplicate(update.update_id)) {
    return new Response("OK");
  }

  if (update.callback_query) {
    await handleModelCallback(update.callback_query);
    return new Response("OK");
  }

  const message = update.message;
  if (!message?.text || message.chat?.id === undefined) {
    return new Response("OK");
  }

  const chatId = String(message.chat.id);
  if (!isAllowedSender(chatId, ALLOWED_IDS)) {
    return new Response("OK");
  }

  if (message.text.trim() === "/model") {
    try {
      await sendModelKeyboard(chatId);
    } catch (err) {
      console.error("Error sending model keyboard:", err);
    }
    return new Response("OK");
  }

  // Process synchronously: Cloud Run throttles CPU once the response is sent,
  // so background work started here would freeze. The Telegram reply goes out
  // via sendMessage before we acknowledge the webhook.
  try {
    const response = await processMessage(message.text);
    await sendMessage(chatId, response, BOT_TOKEN);
  } catch (err) {
    console.error("Error processing message:", err);
    await sendMessage(chatId, "Something went wrong. Check the logs.", BOT_TOKEN).catch(() => {});
  }

  return new Response("OK");
}

async function sendModelKeyboard(chatId: string): Promise<void> {
  const current =
    (await getSelectedProvider()) ?? (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  const providers = availableProviders();
  if (providers.length === 0) {
    await sendMessage(chatId, "No LLM providers are configured.", BOT_TOKEN);
    return;
  }
  const keyboard = {
    inline_keyboard: providers.map((name) => [
      { text: name === current ? `✓ ${name}` : name, callback_data: `model:${name}` },
    ]),
  };
  await sendMessage(chatId, `Current LLM provider: ${current}. Pick one:`, BOT_TOKEN, {
    replyMarkup: keyboard,
  });
}

async function handleModelCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>
): Promise<void> {
  const rawChatId = callback.message?.chat?.id;
  if (rawChatId === undefined) return;
  const chatId = String(rawChatId);
  // Callbacks are a second entry point into the webhook: same silent drop for
  // non-allowlisted chats as messages
  if (!isAllowedSender(chatId, ALLOWED_IDS)) return;

  try {
    // callback_data is attacker-influenced input — accept only exact matches
    // against providers that are currently configured with an API key
    const data = callback.data ?? "";
    const name = data.startsWith("model:") ? data.slice("model:".length) : "";
    if (!availableProviders().includes(name)) {
      await answerCallbackQuery(callback.id, BOT_TOKEN, "That provider isn't available.");
      return;
    }

    await setSelectedProvider(name);
    await answerCallbackQuery(callback.id, BOT_TOKEN, `Switched to ${name}`);
    await editMessageText(chatId, callback.message!.message_id, `✓ Now using ${name}`, BOT_TOKEN);
  } catch (err) {
    console.error("Error handling model callback:", err);
    await answerCallbackQuery(callback.id, BOT_TOKEN).catch(() => {});
  }
}

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    // Cloud Run's default request timeout comfortably covers a few model calls
    idleTimeout: 120,
    routes: {
      "/webhook": {
        POST: handleWebhook,
      },
      "/healthz": {
        GET: () => new Response("ok"),
      },
    },
  });
  console.log(`Telegram agent running on port ${PORT}`);
}
