import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readRepoFile, writeRepoFile } from "./github_store";
import { availableProviders } from "../providers";

const PROVIDER_FILE = "config/llm-provider.txt";

function useGithubStore(): boolean {
  return process.env.STORE === "github";
}

function getRoot(): string {
  return process.env.AIOS_ROOT ?? join(process.env.HOME ?? "", "Desktop/AIS-OS");
}

// Returns the persisted provider choice, or null when none is set, the value
// isn't a currently-available provider, or the store is unreachable — callers
// fall back to the LLM_PROVIDER env default, so a bad file can't brick the bot.
export async function getSelectedProvider(): Promise<string | null> {
  let raw: string | null;
  try {
    if (useGithubStore()) {
      raw = await readRepoFile(PROVIDER_FILE);
    } else {
      const path = join(getRoot(), PROVIDER_FILE);
      raw = existsSync(path) ? readFileSync(path, "utf-8") : null;
    }
  } catch {
    return null;
  }

  const name = (raw ?? "").trim().toLowerCase();
  return name && availableProviders().includes(name) ? name : null;
}

export async function setSelectedProvider(name: string): Promise<void> {
  if (!availableProviders().includes(name)) {
    throw new Error(`Unknown or unavailable provider: ${name}`);
  }

  // Re-selecting the current provider would otherwise create a pointless
  // GitHub commit on every tap
  if ((await getSelectedProvider()) === name) return;

  if (useGithubStore()) {
    await writeRepoFile(PROVIDER_FILE, `${name}\n`, `chore: switch LLM provider to ${name}`);
    return;
  }

  const path = join(getRoot(), PROVIDER_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${name}\n`);
}
