import { test, expect, mock, beforeEach } from "bun:test";

// Mock agent, reply, and model config before importing handler
const mockProcessMessage = mock(() => Promise.resolve("Agent reply"));
const mockSendMessage = mock(() => Promise.resolve());
const mockAnswerCallbackQuery = mock(() => Promise.resolve());
const mockEditMessageText = mock(() => Promise.resolve());
const mockGetSelectedProvider = mock((): Promise<string | null> => Promise.resolve(null));
const mockSetSelectedProvider = mock(() => Promise.resolve());

mock.module("./agent", () => ({
  processMessage: mockProcessMessage,
}));

mock.module("./tools/reply", () => ({
  sendMessage: mockSendMessage,
  answerCallbackQuery: mockAnswerCallbackQuery,
  editMessageText: mockEditMessageText,
}));

mock.module("./lib/model_config", () => ({
  getSelectedProvider: mockGetSelectedProvider,
  setSelectedProvider: mockSetSelectedProvider,
}));

process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.ALLOWED_CHAT_IDS = "182526906";
process.env.TELEGRAM_BOT_TOKEN = "test-token";
// availableProviders() is env-driven (no mock needed): anthropic + openai only
process.env.ANTHROPIC_API_KEY = "a-key";
process.env.OPENAI_API_KEY = "o-key";
delete process.env.OPENROUTER_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_PROVIDER;

const { handleWebhook } = await import("./server");

let nextUpdateId = 1;

beforeEach(() => {
  mockProcessMessage.mockClear();
  mockSendMessage.mockClear();
  mockAnswerCallbackQuery.mockClear();
  mockEditMessageText.mockClear();
  mockGetSelectedProvider.mockClear();
  mockSetSelectedProvider.mockClear();
  mockGetSelectedProvider.mockImplementation(() => Promise.resolve(null));
});

function makeCallback(data = "model:openai", chatId = 182526906) {
  return {
    update_id: nextUpdateId++,
    callback_query: {
      id: `cbq-${nextUpdateId}`,
      data,
      message: { message_id: 7, chat: { id: chatId } },
    },
  };
}

function makeRequest(body: object | string, secret: string | null = "test-secret") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (secret) headers.set("x-telegram-bot-api-secret-token", secret);
  return new Request("http://localhost:3000/webhook", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeUpdate(text = "hello", chatId = 182526906) {
  return {
    update_id: nextUpdateId++,
    message: { message_id: 1, chat: { id: chatId }, text },
  };
}

test("handleWebhook: returns 401 for missing secret", async () => {
  const res = await handleWebhook(makeRequest({}, null));
  expect(res.status).toBe(401);
});

test("handleWebhook: returns 401 for wrong secret", async () => {
  const res = await handleWebhook(makeRequest({}, "wrong-secret"));
  expect(res.status).toBe(401);
});

test("handleWebhook: returns 200 and replies for a valid request", async () => {
  const res = await handleWebhook(makeRequest(makeUpdate()));
  expect(res.status).toBe(200);
  // Synchronous processing: the reply has been sent by the time we respond
  expect(mockProcessMessage).toHaveBeenCalledWith("hello");
  expect(mockSendMessage).toHaveBeenCalledWith("182526906", "Agent reply", "test-token");
});

test("handleWebhook: returns 200 and silently drops unknown sender", async () => {
  const res = await handleWebhook(makeRequest(makeUpdate("hello", 999999)));
  expect(res.status).toBe(200);
  expect(mockProcessMessage).not.toHaveBeenCalled();
});

test("handleWebhook: returns 200 for update with no message text", async () => {
  const res = await handleWebhook(makeRequest({ update_id: nextUpdateId++ }));
  expect(res.status).toBe(200);
  expect(mockProcessMessage).not.toHaveBeenCalled();
});

test("handleWebhook: returns 200 for malformed JSON without throwing", async () => {
  const res = await handleWebhook(makeRequest("{not json"));
  expect(res.status).toBe(200);
  expect(mockProcessMessage).not.toHaveBeenCalled();
});

test("handleWebhook: ignores a redelivered update_id (Telegram retry)", async () => {
  const update = makeUpdate("process me once");
  await handleWebhook(makeRequest(update));
  const res = await handleWebhook(makeRequest(update));
  expect(res.status).toBe(200);
  expect(mockProcessMessage).toHaveBeenCalledTimes(1);
});

test("/model: replies with an inline keyboard of available providers, not the agent", async () => {
  const res = await handleWebhook(makeRequest(makeUpdate("/model")));
  expect(res.status).toBe(200);
  expect(mockProcessMessage).not.toHaveBeenCalled();

  expect(mockSendMessage).toHaveBeenCalledTimes(1);
  const [chatId, text, token, extra] = (mockSendMessage.mock.calls[0] ?? []) as any[];
  expect(chatId).toBe("182526906");
  expect(text).toContain("anthropic");
  expect(token).toBe("test-token");
  expect(extra.replyMarkup.inline_keyboard).toEqual([
    [{ text: "✓ anthropic", callback_data: "model:anthropic" }],
    [{ text: "openai", callback_data: "model:openai" }],
  ]);
});

test("/model: marks the persisted provider as current when one is set", async () => {
  mockGetSelectedProvider.mockImplementation(() => Promise.resolve("openai"));
  await handleWebhook(makeRequest(makeUpdate("/model")));
  const extra = (mockSendMessage.mock.calls[0] as any[])[3];
  expect(extra.replyMarkup.inline_keyboard).toEqual([
    [{ text: "anthropic", callback_data: "model:anthropic" }],
    [{ text: "✓ openai", callback_data: "model:openai" }],
  ]);
});

test("callback_query: persists a valid provider, answers, and edits the message", async () => {
  const res = await handleWebhook(makeRequest(makeCallback("model:openai")));
  expect(res.status).toBe(200);
  expect(mockSetSelectedProvider).toHaveBeenCalledWith("openai");
  expect(mockAnswerCallbackQuery).toHaveBeenCalledTimes(1);
  const editArgs = mockEditMessageText.mock.calls[0] as any[];
  expect(editArgs[0]).toBe("182526906");
  expect(editArgs[1]).toBe(7);
  expect(editArgs[2]).toContain("openai");
});

test("callback_query: silently drops callbacks from non-allowlisted chats", async () => {
  const res = await handleWebhook(makeRequest(makeCallback("model:openai", 999999)));
  expect(res.status).toBe(200);
  expect(mockSetSelectedProvider).not.toHaveBeenCalled();
  expect(mockAnswerCallbackQuery).not.toHaveBeenCalled();
  expect(mockEditMessageText).not.toHaveBeenCalled();
});

test("callback_query: rejects unknown or unavailable providers without persisting", async () => {
  for (const data of ["model:grok", "model:gemini", "not-even-a-model", ""]) {
    mockSetSelectedProvider.mockClear();
    mockEditMessageText.mockClear();
    await handleWebhook(makeRequest(makeCallback(data)));
    expect(mockSetSelectedProvider).not.toHaveBeenCalled();
    expect(mockEditMessageText).not.toHaveBeenCalled();
  }
});

test("callback_query: a redelivered update_id is not processed twice", async () => {
  const update = makeCallback("model:openai");
  await handleWebhook(makeRequest(update));
  await handleWebhook(makeRequest(update));
  expect(mockSetSelectedProvider).toHaveBeenCalledTimes(1);
});

test("handleWebhook: sends an apology and still returns 200 when processing fails", async () => {
  mockProcessMessage.mockImplementationOnce(() => Promise.reject(new Error("boom")));
  const res = await handleWebhook(makeRequest(makeUpdate("explode")));
  expect(res.status).toBe(200);
  expect(mockSendMessage).toHaveBeenCalledWith(
    "182526906",
    "Something went wrong. Check the logs.",
    "test-token"
  );
});
