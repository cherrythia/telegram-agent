import { test, expect, mock, beforeEach, afterEach } from "bun:test";

const originalFetch = globalThis.fetch;
const mockFetch = mock((..._args: any[]) =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
);

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Cache-busted import: server.test.ts registers mock.module("./tools/reply"), and
// Bun module mocks are process-global across test files — a plain import here
// would receive that mock when the full suite runs.
const { sendMessage, answerCallbackQuery, editMessageText } = await import(
  "./reply?" + Math.random()
);

test("sendMessage: calls Telegram API with correct URL", async () => {
  await sendMessage("182526906", "Hello", "test-token");
  expect(mockFetch).toHaveBeenCalledWith(
    "https://api.telegram.org/bottest-token/sendMessage",
    expect.anything()
  );
});

test("sendMessage: sends correct JSON body", async () => {
  await sendMessage("182526906", "Hello world", "test-token");
  const call = mockFetch.mock.calls[0]!;
  const body = JSON.parse((call[1] as RequestInit).body as string);
  expect(body).toEqual({ chat_id: "182526906", text: "Hello world" });
});

test("sendMessage: includes reply_markup when a keyboard is passed", async () => {
  const keyboard = { inline_keyboard: [[{ text: "openai", callback_data: "model:openai" }]] };
  await sendMessage("182526906", "Pick one:", "test-token", { replyMarkup: keyboard });
  const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
  expect(body.reply_markup).toEqual(keyboard);
});

test("answerCallbackQuery: posts the callback id and optional text", async () => {
  await answerCallbackQuery("cbq-1", "test-token", "Switched");
  expect(mockFetch).toHaveBeenCalledWith(
    "https://api.telegram.org/bottest-token/answerCallbackQuery",
    expect.anything()
  );
  const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
  expect(body).toEqual({ callback_query_id: "cbq-1", text: "Switched" });
});

test("editMessageText: posts chat id, message id, and new text", async () => {
  await editMessageText("182526906", 42, "✓ Now using openai", "test-token");
  expect(mockFetch).toHaveBeenCalledWith(
    "https://api.telegram.org/bottest-token/editMessageText",
    expect.anything()
  );
  const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
  expect(body).toEqual({ chat_id: "182526906", message_id: 42, text: "✓ Now using openai" });
});

test("sendMessage: throws on non-ok response", async () => {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve(new Response("Bad Request", { status: 400 }))
  );
  await expect(sendMessage("123", "test", "token")).rejects.toThrow(
    "Telegram sendMessage failed: 400"
  );
});
