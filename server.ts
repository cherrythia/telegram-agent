import { validateWebhookSecret, isAllowedSender } from "./lib/validation";
import { processMessage } from "./agent";
import { sendMessage } from "./tools/reply";

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

  const message = update.message;
  if (!message?.text || message.chat?.id === undefined) {
    return new Response("OK");
  }

  if (typeof update.update_id === "number" && isDuplicate(update.update_id)) {
    return new Response("OK");
  }

  const chatId = String(message.chat.id);
  if (!isAllowedSender(chatId, ALLOWED_IDS)) {
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
