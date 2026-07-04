async function telegramPost(
  method: string,
  botToken: string,
  body: Record<string, unknown>
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Telegram ${method} failed: ${response.status}`);
  }
}

export async function sendMessage(
  chatId: string,
  text: string,
  botToken: string,
  extra?: { replyMarkup?: unknown }
): Promise<void> {
  await telegramPost("sendMessage", botToken, {
    chat_id: chatId,
    text,
    ...(extra?.replyMarkup !== undefined ? { reply_markup: extra.replyMarkup } : {}),
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  botToken: string,
  text?: string
): Promise<void> {
  await telegramPost("answerCallbackQuery", botToken, {
    callback_query_id: callbackQueryId,
    ...(text !== undefined ? { text } : {}),
  });
}

export async function editMessageText(
  chatId: string,
  messageId: number,
  text: string,
  botToken: string
): Promise<void> {
  await telegramPost("editMessageText", botToken, {
    chat_id: chatId,
    message_id: messageId,
    text,
  });
}
