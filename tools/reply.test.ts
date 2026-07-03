import { test, expect, mock, beforeEach } from "bun:test";

const mockFetch = mock((..._args: any[]) =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
);

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockClear();
});

// Cache-busted import: server.test.ts registers mock.module("./tools/reply"), and
// Bun module mocks are process-global across test files — a plain import here
// would receive that mock when the full suite runs.
const { sendMessage } = await import("./reply?" + Math.random());

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

test("sendMessage: throws on non-ok response", async () => {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve(new Response("Bad Request", { status: 400 }))
  );
  await expect(sendMessage("123", "test", "token")).rejects.toThrow(
    "Telegram sendMessage failed: 400"
  );
});
