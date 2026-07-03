import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_ROOT = "/tmp/test-aios-root";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mkdirSync(join(TEST_ROOT, "context"), { recursive: true });
  mkdirSync(join(TEST_ROOT, "decisions"), { recursive: true });
  mkdirSync(join(TEST_ROOT, "references"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "context", "priorities.md"), "# Priorities\n1. Ship things.");
  writeFileSync(join(TEST_ROOT, "decisions", "log.md"), "# Decisions Log\n\n---\n");
  process.env.AIOS_ROOT = TEST_ROOT;
  process.env.GITHUB_REPO = "test-owner/test-context";
  delete process.env.STORE;
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  delete process.env.STORE;
});

async function getModule() {
  return await import("./context_tools?" + Math.random());
}

test("readContext: returns content for an allowlisted file", async () => {
  const { readContext } = await getModule();
  expect(await readContext("context/priorities.md")).toContain("Ship things");
});

test("readContext: returns null for a non-allowlisted file", async () => {
  const { readContext } = await getModule();
  expect(await readContext("context/not-real.md")).toBeNull();
});

test("readContext: rejects path traversal attempts", async () => {
  const { readContext } = await getModule();
  expect(await readContext("../../../etc/passwd")).toBeNull();
  expect(await readContext("context/../../../etc/passwd")).toBeNull();
});

test("readContext: returns null when allowlisted file doesn't exist on disk", async () => {
  const { readContext } = await getModule();
  expect(await readContext("references/voice.md")).toBeNull();
});

test("logDecision: appends a formatted entry to decisions/log.md", async () => {
  const { logDecision } = await getModule();
  await logDecision({
    title: "Use Bun for everything",
    decision: "Use Bun instead of Node.",
    why: "Faster startup, built-in test runner.",
  });
  const content = readFileSync(join(TEST_ROOT, "decisions", "log.md"), "utf-8");
  expect(content).toContain("Use Bun for everything");
  expect(content).toContain("**Decision:** Use Bun instead of Node.");
  expect(content).toContain("**Why:** Faster startup, built-in test runner.");
});

test("logDecision: includes alternatives and owner when provided", async () => {
  const { logDecision } = await getModule();
  await logDecision({
    title: "Pick a DB",
    decision: "Use SQLite.",
    why: "Simplicity.",
    alternatives: "Postgres, Mongo",
    owner: "Terry",
  });
  const content = readFileSync(join(TEST_ROOT, "decisions", "log.md"), "utf-8");
  expect(content).toContain("**Alternatives considered:** Postgres, Mongo");
  expect(content).toContain("**Owner:** Terry");
});

test("logDecision: omits alternatives/owner lines when not provided", async () => {
  const { logDecision } = await getModule();
  await logDecision({
    title: "Minimal entry",
    decision: "Just do it.",
    why: "No reason needed.",
  });
  const content = readFileSync(join(TEST_ROOT, "decisions", "log.md"), "utf-8");
  expect(content).not.toContain("**Alternatives considered:**");
  expect(content).not.toContain("**Owner:**");
});

test("saveNote: appends a dated entry to context/notes.md", async () => {
  writeFileSync(join(TEST_ROOT, "context", "notes.md"), "# Notes\n");
  const { saveNote } = await getModule();
  await saveNote({ note: "Bun auto-loads .env files.", topic: "Bun" });
  const content = readFileSync(join(TEST_ROOT, "context", "notes.md"), "utf-8");
  expect(content).toContain("— Bun");
  expect(content).toContain("Bun auto-loads .env files.");
});

test("saveNote: defaults the heading when no topic is given", async () => {
  writeFileSync(join(TEST_ROOT, "context", "notes.md"), "# Notes\n");
  const { saveNote } = await getModule();
  await saveNote({ note: "Plain note." });
  const content = readFileSync(join(TEST_ROOT, "context", "notes.md"), "utf-8");
  expect(content).toContain("— Note");
  expect(content).toContain("Plain note.");
});

test("STORE=github: saveNote commits the appended note to the repo", async () => {
  process.env.STORE = "github";
  process.env.GITHUB_TOKEN = "test-token";

  let putBody: any = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PUT") {
      putBody = JSON.parse(String(init.body));
      return Response.json({ ok: true });
    }
    return Response.json({
      content: Buffer.from("# Notes\n").toString("base64"),
      sha: "sha-1",
    });
  }) as typeof fetch;

  const { saveNote } = await getModule();
  await saveNote({ note: "GitHub PATs can be repo-scoped.", topic: "GitHub" });

  expect(putBody).not.toBeNull();
  expect(putBody.message).toContain("save note");
  const committed = Buffer.from(putBody.content, "base64").toString("utf-8");
  expect(committed).toContain("GitHub PATs can be repo-scoped.");
});

test("STORE=github: readContext fetches via the GitHub contents API", async () => {
  process.env.STORE = "github";
  process.env.GITHUB_TOKEN = "test-token";

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/contents/context/priorities.md")) {
      return Response.json({
        content: Buffer.from("# Priorities (repo)\nShip cloud things.").toString("base64"),
        sha: "abc",
      });
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const { readContext } = await getModule();
  expect(await readContext("context/priorities.md")).toContain("Ship cloud things");
  // Allowlist still applies in github mode
  expect(await readContext("secrets/keys.md")).toBeNull();
});

test("STORE=github: logDecision commits the appended entry back to the repo", async () => {
  process.env.STORE = "github";
  process.env.GITHUB_TOKEN = "test-token";

  let putBody: any = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PUT") {
      putBody = JSON.parse(String(init.body));
      return Response.json({ ok: true });
    }
    return Response.json({
      content: Buffer.from("# Decisions Log\n").toString("base64"),
      sha: "sha-1",
    });
  }) as typeof fetch;

  const { logDecision } = await getModule();
  await logDecision({
    title: "Move bot to Cloud Run",
    decision: "Deploy on Cloud Run.",
    why: "Free tier.",
  });

  expect(putBody).not.toBeNull();
  expect(putBody.message).toContain("Move bot to Cloud Run");
  const committed = Buffer.from(putBody.content, "base64").toString("utf-8");
  expect(committed).toContain("# Decisions Log");
  expect(committed).toContain("**Decision:** Deploy on Cloud Run.");
});
