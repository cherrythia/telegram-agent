import { test, expect, beforeEach, afterEach } from "bun:test";
import { readRepoFile, listRepoDir, appendToRepoFile, clearCache } from "./github_store";

const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls = [];
  clearCache();
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPO = "test-owner/test-context";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("readRepoFile: decodes base64 content from the contents API", async () => {
  mockFetch(() =>
    Response.json({ content: b64("# Priorities\nShip things."), sha: "abc" })
  );
  const content = await readRepoFile("context/priorities.md");
  expect(content).toContain("Ship things");
  expect(fetchCalls[0]!.url).toContain("/repos/test-owner/test-context/contents/context/priorities.md");
});

test("readRepoFile: returns null on 404", async () => {
  mockFetch(() => new Response("Not Found", { status: 404 }));
  expect(await readRepoFile("context/missing.md")).toBeNull();
});

test("readRepoFile: serves repeated reads from cache within TTL", async () => {
  mockFetch(() => Response.json({ content: b64("cached"), sha: "abc" }));
  await readRepoFile("context/priorities.md");
  await readRepoFile("context/priorities.md");
  expect(fetchCalls.length).toBe(1);
});

test("readRepoFile: sends the auth token", async () => {
  mockFetch(() => Response.json({ content: b64("x"), sha: "abc" }));
  await readRepoFile("context/priorities.md");
  const headers = fetchCalls[0]!.init?.headers as Record<string, string>;
  expect(headers.Authorization).toBe("Bearer test-token");
});

test("readRepoFile: throws when GITHUB_TOKEN is missing", async () => {
  delete process.env.GITHUB_TOKEN;
  expect(readRepoFile("context/priorities.md")).rejects.toThrow("GITHUB_TOKEN");
});

test("readRepoFile: throws when GITHUB_REPO is missing", async () => {
  delete process.env.GITHUB_REPO;
  expect(readRepoFile("context/priorities.md")).rejects.toThrow("GITHUB_REPO");
});

test("listRepoDir: returns only directory names", async () => {
  mockFetch(() =>
    Response.json([
      { name: "audit", type: "dir" },
      { name: "level-up", type: "dir" },
      { name: "README.md", type: "file" },
    ])
  );
  expect(await listRepoDir(".claude/skills")).toEqual(["audit", "level-up"]);
});

test("listRepoDir: returns empty array on 404", async () => {
  mockFetch(() => new Response("Not Found", { status: 404 }));
  expect(await listRepoDir(".claude/skills")).toEqual([]);
});

test("appendToRepoFile: PUTs appended content with the current sha", async () => {
  mockFetch((url, init) => {
    if (init?.method === "PUT") return Response.json({ ok: true });
    return Response.json({ content: b64("# Log\n"), sha: "sha-1" });
  });

  await appendToRepoFile("decisions/log.md", "\n## New entry\n", "chore: log decision");

  const put = fetchCalls.find((c) => c.init?.method === "PUT");
  expect(put).toBeDefined();
  const body = JSON.parse(String(put!.init!.body));
  expect(body.sha).toBe("sha-1");
  expect(body.message).toBe("chore: log decision");
  expect(Buffer.from(body.content, "base64").toString("utf-8")).toBe("# Log\n\n## New entry\n");
});

test("appendToRepoFile: throws when the file doesn't exist", async () => {
  mockFetch(() => new Response("Not Found", { status: 404 }));
  expect(
    appendToRepoFile("decisions/missing.md", "x", "msg")
  ).rejects.toThrow("not found");
});

test("appendToRepoFile: throws on commit failure", async () => {
  mockFetch((url, init) => {
    if (init?.method === "PUT") return new Response("Conflict", { status: 409 });
    return Response.json({ content: b64("# Log\n"), sha: "sha-1" });
  });
  expect(
    appendToRepoFile("decisions/log.md", "x", "msg")
  ).rejects.toThrow("409");
});
