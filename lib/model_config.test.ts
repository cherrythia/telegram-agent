import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { clearCache } from "./github_store";

const TEST_ROOT = "/tmp/test-aios-model-config";

const originalFetch = globalThis.fetch;
const originalEnv = {
  STORE: process.env.STORE,
  AIOS_ROOT: process.env.AIOS_ROOT,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_REPO: process.env.GITHUB_REPO,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  process.env.AIOS_ROOT = TEST_ROOT;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPO = "test-owner/test-context";
  process.env.ANTHROPIC_API_KEY = "a-key";
  process.env.OPENAI_API_KEY = "o-key";
  delete process.env.STORE;
  clearCache();
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Cache-busted import: server.test.ts and agent.test.ts register
// mock.module("./lib/model_config"), and Bun module mocks are process-global
// across test files — a plain import here could receive that mock.
async function getModule() {
  return await import("./model_config?" + Math.random());
}

test("getSelectedProvider: returns null when nothing has been persisted", async () => {
  const { getSelectedProvider } = await getModule();
  expect(await getSelectedProvider()).toBeNull();
});

test("setSelectedProvider then getSelectedProvider round-trips locally", async () => {
  const { getSelectedProvider, setSelectedProvider } = await getModule();
  await setSelectedProvider("openai");
  expect(await getSelectedProvider()).toBe("openai");
  expect(readFileSync(join(TEST_ROOT, "config/llm-provider.txt"), "utf-8").trim()).toBe("openai");
});

test("setSelectedProvider: rejects providers that are unknown or have no API key", async () => {
  const { setSelectedProvider } = await getModule();
  expect(setSelectedProvider("grok")).rejects.toThrow("provider");
  delete process.env.OPENAI_API_KEY;
  expect(setSelectedProvider("openai")).rejects.toThrow("provider");
  expect(existsSync(join(TEST_ROOT, "config/llm-provider.txt"))).toBe(false);
});

test("getSelectedProvider: ignores a persisted provider that is no longer available", async () => {
  mkdirSync(join(TEST_ROOT, "config"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "config/llm-provider.txt"), "openai\n");
  delete process.env.OPENAI_API_KEY;
  const { getSelectedProvider } = await getModule();
  expect(await getSelectedProvider()).toBeNull();
});

test("STORE=github: setSelectedProvider commits the choice to the context repo", async () => {
  process.env.STORE = "github";

  let putBody: any = null;
  let putUrl = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PUT") {
      putUrl = String(input);
      putBody = JSON.parse(String(init.body));
      return Response.json({ ok: true });
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const { setSelectedProvider } = await getModule();
  await setSelectedProvider("openai");

  expect(putUrl).toContain("/contents/config/llm-provider.txt");
  expect(putBody.message).toContain("openai");
  expect(Buffer.from(putBody.content, "base64").toString("utf-8").trim()).toBe("openai");
});

test("STORE=github: re-selecting the current provider does not create another commit", async () => {
  process.env.STORE = "github";

  let putCount = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PUT") {
      putCount++;
      return Response.json({ ok: true });
    }
    if (String(input).includes("/contents/config/llm-provider.txt")) {
      return Response.json({
        content: Buffer.from("openai\n").toString("base64"),
        sha: "abc",
      });
    }
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;

  const { setSelectedProvider } = await getModule();
  await setSelectedProvider("openai");
  expect(putCount).toBe(0);
});

test("STORE=github: getSelectedProvider reads the choice via the contents API", async () => {
  process.env.STORE = "github";

  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).includes("/contents/config/llm-provider.txt")) {
      return Response.json({
        content: Buffer.from("openai\n").toString("base64"),
        sha: "abc",
      });
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const { getSelectedProvider } = await getModule();
  expect(await getSelectedProvider()).toBe("openai");
});

test("STORE=github: getSelectedProvider returns null instead of throwing when the read fails", async () => {
  process.env.STORE = "github";
  globalThis.fetch = (async () =>
    new Response("boom", { status: 500 })) as unknown as typeof fetch;
  const { getSelectedProvider } = await getModule();
  expect(await getSelectedProvider()).toBeNull();
});
