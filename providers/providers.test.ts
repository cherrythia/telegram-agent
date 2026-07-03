import { test, expect, beforeEach, afterEach } from "bun:test";
import { OpenAICompatibleProvider } from "./openai_compatible";
import { getProvider } from "./index";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_MODEL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_MODEL;
});

function mockCompletionResponse(message: object) {
  let captured: any = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(input), body: JSON.parse(String(init?.body)) };
    return Response.json({ choices: [{ message }] });
  }) as typeof fetch;
  return () => captured;
}

test("getProvider: defaults to anthropic", () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const provider = getProvider();
  expect(provider.constructor.name).toBe("AnthropicProvider");
});

test("getProvider: rejects unknown provider names", () => {
  process.env.LLM_PROVIDER = "grok";
  expect(() => getProvider()).toThrow("Unknown LLM_PROVIDER");
});

test("getProvider: requires the provider's API key", () => {
  process.env.LLM_PROVIDER = "openrouter";
  delete process.env.OPENROUTER_API_KEY;
  expect(() => getProvider()).toThrow("OPENROUTER_API_KEY");
});

test("getProvider: builds an OpenAI-compatible provider for openai", () => {
  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key";
  expect(getProvider().constructor.name).toBe("OpenAICompatibleProvider");
});

test("OpenAICompatibleProvider: sends system prompt, model, and user message", async () => {
  const getCaptured = mockCompletionResponse({ content: "Hi Terry" });
  const provider = new OpenAICompatibleProvider("https://api.openai.com/v1", "key", "gpt-4o-mini");

  const turn = await provider.complete({
    system: "You are helpful.",
    messages: [{ role: "user", text: "Hello" }],
    maxTokens: 512,
  });

  const { url, body } = getCaptured();
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  expect(body.model).toBe("gpt-4o-mini");
  expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
  expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
  expect(turn.text).toBe("Hi Terry");
  expect(turn.toolCalls).toEqual([]);
});

test("OpenAICompatibleProvider: maps tools to function-calling format", async () => {
  const getCaptured = mockCompletionResponse({ content: "ok" });
  const provider = new OpenAICompatibleProvider("https://openrouter.ai/api/v1", "key", "m");

  await provider.complete({
    system: "s",
    messages: [{ role: "user", text: "u" }],
    tools: [
      {
        name: "read_context",
        description: "Read a file",
        inputSchema: { type: "object", properties: { file: { type: "string" } } },
      },
    ],
    maxTokens: 512,
  });

  const { body } = getCaptured();
  expect(body.tools[0].type).toBe("function");
  expect(body.tools[0].function.name).toBe("read_context");
  expect(body.tools[0].function.parameters.properties.file.type).toBe("string");
});

test("OpenAICompatibleProvider: parses tool calls from the response", async () => {
  mockCompletionResponse({
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "read_context", arguments: '{"file":"context/priorities.md"}' },
      },
    ],
  });
  const provider = new OpenAICompatibleProvider("https://api.openai.com/v1", "key", "m");

  const turn = await provider.complete({
    system: "s",
    messages: [{ role: "user", text: "u" }],
    maxTokens: 512,
  });

  expect(turn.toolCalls).toEqual([
    { id: "call_1", name: "read_context", input: { file: "context/priorities.md" } },
  ]);
});

test("OpenAICompatibleProvider: round-trips assistant tool calls and tool results", async () => {
  const getCaptured = mockCompletionResponse({ content: "done" });
  const provider = new OpenAICompatibleProvider("https://api.openai.com/v1", "key", "m");

  await provider.complete({
    system: "s",
    messages: [
      { role: "user", text: "What are my priorities?" },
      {
        role: "assistant",
        toolCalls: [{ id: "call_1", name: "read_context", input: { file: "context/priorities.md" } }],
      },
      { role: "tool_results", results: [{ id: "call_1", content: "Ship things", isError: false }] },
    ],
    maxTokens: 512,
  });

  const { body } = getCaptured();
  const assistant = body.messages[2];
  expect(assistant.role).toBe("assistant");
  expect(assistant.tool_calls[0].function.name).toBe("read_context");
  const toolMsg = body.messages[3];
  expect(toolMsg).toEqual({ role: "tool", tool_call_id: "call_1", content: "Ship things" });
});

test("OpenAICompatibleProvider: throws a readable error on HTTP failure", async () => {
  globalThis.fetch = (async () =>
    new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
  const provider = new OpenAICompatibleProvider("https://api.openai.com/v1", "key", "m");

  expect(
    provider.complete({ system: "s", messages: [{ role: "user", text: "u" }], maxTokens: 512 })
  ).rejects.toThrow("429");
});
