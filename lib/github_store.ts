const API_BASE = "https://api.github.com";
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  content: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function repo(): string {
  const value = process.env.GITHUB_REPO;
  if (!value) throw new Error("GITHUB_REPO is not set");
  return value;
}

function branch(): string {
  return process.env.GITHUB_BRANCH ?? "main";
}

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl(path: string): string {
  return `${API_BASE}/repos/${repo()}/contents/${path}?ref=${branch()}`;
}

async function fetchContents(path: string): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(contentsUrl(path), { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed for ${path}: ${res.status}`);
  const data = (await res.json()) as { content: string; sha: string };
  return {
    content: Buffer.from(data.content, "base64").toString("utf-8"),
    sha: data.sha,
  };
}

export async function readRepoFile(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.content;
  }
  const result = await fetchContents(path);
  if (result === null) return null;
  cache.set(path, { content: result.content, fetchedAt: Date.now() });
  return result.content;
}

export async function listRepoDir(path: string): Promise<string[]> {
  const res = await fetch(contentsUrl(path), { headers: headers() });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list failed for ${path}: ${res.status}`);
  const entries = (await res.json()) as Array<{ name: string; type: string }>;
  return entries.filter((e) => e.type === "dir").map((e) => e.name);
}

export async function appendToRepoFile(
  path: string,
  text: string,
  commitMessage: string
): Promise<void> {
  // Bypass the cache: the append needs the current sha for the optimistic-lock PUT
  const existing = await fetchContents(path);
  if (existing === null) throw new Error(`Cannot append: ${path} not found in ${repo()}`);

  const updated = existing.content + text;
  const res = await fetch(`${API_BASE}/repos/${repo()}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(updated, "utf-8").toString("base64"),
      sha: existing.sha,
      branch: branch(),
    }),
  });
  if (!res.ok) throw new Error(`GitHub commit failed for ${path}: ${res.status}`);

  cache.set(path, { content: updated, fetchedAt: Date.now() });
}

export function clearCache(): void {
  cache.clear();
}
