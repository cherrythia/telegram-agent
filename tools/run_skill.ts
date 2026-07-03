import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRepoFile, listRepoDir } from "../lib/github_store";

const REPO_SKILLS_DIR = ".claude/skills";

function useGithubStore(): boolean {
  return process.env.STORE === "github";
}

function getSkillDirs(): string[] {
  return [
    process.env.SKILLS_DIR_GLOBAL ?? `${process.env.HOME}/.claude/skills`,
    process.env.SKILLS_DIR_PROJECT ?? `${process.env.HOME}/Desktop/AIS-OS/.claude/skills`,
  ].filter(Boolean);
}

export async function listSkills(): Promise<string[]> {
  if (useGithubStore()) {
    return (await listRepoDir(REPO_SKILLS_DIR)).sort();
  }

  const skills = new Set<string>();
  for (const dir of getSkillDirs()) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) skills.add(entry.name);
    }
  }
  return [...skills].sort();
}

export async function readSkill(name: string): Promise<string | null> {
  // Reject any name containing path separators or dots
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }

  const knownSkills = await listSkills();
  if (!knownSkills.includes(name)) return null;

  if (useGithubStore()) {
    return readRepoFile(`${REPO_SKILLS_DIR}/${name}/SKILL.md`);
  }

  for (const dir of getSkillDirs()) {
    const skillPath = join(dir, name, "SKILL.md");
    if (existsSync(skillPath)) {
      return readFileSync(skillPath, "utf-8");
    }
  }
  return null;
}
