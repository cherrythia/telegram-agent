import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/test-skills-global";
const TEST_DIR_PROJECT = "/tmp/test-skills-project";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mkdirSync(join(TEST_DIR, "audit"), { recursive: true });
  writeFileSync(join(TEST_DIR, "audit", "SKILL.md"), "# Audit Skill\nRun an audit.");
  mkdirSync(join(TEST_DIR_PROJECT, "level-up"), { recursive: true });
  writeFileSync(join(TEST_DIR_PROJECT, "level-up", "SKILL.md"), "# Level Up Skill\nLevel up.");
  process.env.SKILLS_DIR_GLOBAL = TEST_DIR;
  process.env.SKILLS_DIR_PROJECT = TEST_DIR_PROJECT;
  process.env.GITHUB_REPO = "test-owner/test-context";
  delete process.env.STORE;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(TEST_DIR_PROJECT, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  delete process.env.STORE;
});

// Re-import after env vars are set
async function getModule() {
  return await import("./run_skill?" + Math.random());
}

test("listSkills: returns skills from both directories", async () => {
  const { listSkills } = await getModule();
  const skills = await listSkills();
  expect(skills).toContain("audit");
  expect(skills).toContain("level-up");
});

test("readSkill: returns SKILL.md content for known skill in global dir", async () => {
  const { readSkill } = await getModule();
  const content = await readSkill("audit");
  expect(content).toContain("# Audit Skill");
});

test("readSkill: returns SKILL.md content for known skill in project dir", async () => {
  const { readSkill } = await getModule();
  const content = await readSkill("level-up");
  expect(content).toContain("# Level Up Skill");
});

test("readSkill: returns null for unknown skill", async () => {
  const { readSkill } = await getModule();
  expect(await readSkill("nonexistent")).toBeNull();
});

test("readSkill: rejects path traversal attempts", async () => {
  const { readSkill } = await getModule();
  expect(await readSkill("../../../etc/passwd")).toBeNull();
  expect(await readSkill("../secret")).toBeNull();
});

test("STORE=github: lists and reads skills via the GitHub contents API", async () => {
  process.env.STORE = "github";
  process.env.GITHUB_TOKEN = "test-token";

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/contents/.claude/skills/audit/SKILL.md")) {
      return Response.json({
        content: Buffer.from("# Audit Skill (repo)").toString("base64"),
        sha: "abc",
      });
    }
    if (url.includes("/contents/.claude/skills")) {
      return Response.json([
        { name: "audit", type: "dir" },
        { name: "onboard", type: "dir" },
      ]);
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  const { listSkills, readSkill } = await getModule();
  expect(await listSkills()).toEqual(["audit", "onboard"]);
  expect(await readSkill("audit")).toContain("# Audit Skill (repo)");
});
