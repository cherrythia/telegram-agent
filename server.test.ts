import { test, expect, mock, beforeEach } from "bun:test";

// Mock agent and reply before importing handler
const mockProcessMessage = mock(() => Promise.resolve("Agent reply"));
const mockSendMessage = mock(() => Promise.resolve());

mock.module("./agent", () => ({
  processMessage: mockProcessMessage,
}));

mock.module("./tools/reply", () => ({
  sendMessage: mockSendMessage,
}));

process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.ALLOWED_CHAT_IDS = "182526906";
process.env.TELEGRAM_BOT_TOKEN = "test-token";

const { handleWebhook } = await import("./server");

let nextUpdateId = 1;

beforeEach(() => {
  mockProcessMessage.mockClear();
  mockSendMessage.mockClear();
});

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
