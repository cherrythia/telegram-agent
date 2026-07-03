import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { readRepoFile, appendToRepoFile } from "../lib/github_store";

const ALLOWED_CONTEXT_FILES = [
  "context/about-me.md",
  "context/about-business.md",
  "context/priorities.md",
  "context/notes.md",
  "decisions/log.md",
  "references/voice.md",
];

const DECISIONS_LOG = "decisions/log.md";
const NOTES_FILE = "context/notes.md";

function useGithubStore(): boolean {
  return process.env.STORE === "github";
}

function getRoot(): string {
  return process.env.AIOS_ROOT ?? join(process.env.HOME ?? "", "Desktop/AIS-OS");
}

export async function readContext(file: string): Promise<string | null> {
  if (!ALLOWED_CONTEXT_FILES.includes(file)) return null;

  if (useGithubStore()) {
    return readRepoFile(file);
  }

  const path = join(getRoot(), file);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function listContextFiles(): string[] {
  return ALLOWED_CONTEXT_FILES;
}

export interface DecisionEntry {
  title: string;
  decision: string;
  why: string;
  alternatives?: string;
  owner?: string;
}

function formatEntry(entry: DecisionEntry): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "",
    `## ${date} — ${entry.title}`,
    "",
    `**Decision:** ${entry.decision}`,
    "",
    `**Why:** ${entry.why}`,
  ];
  if (entry.alternatives) {
    lines.push("", `**Alternatives considered:** ${entry.alternatives}`);
  }
  if (entry.owner) {
    lines.push("", `**Owner:** ${entry.owner}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function logDecision(entry: DecisionEntry): Promise<void> {
  const text = formatEntry(entry);

  if (useGithubStore()) {
    await appendToRepoFile(DECISIONS_LOG, text, `chore: log decision — ${entry.title}`);
    return;
  }

  appendFileSync(join(getRoot(), DECISIONS_LOG), text);
}

export interface NoteEntry {
  note: string;
  topic?: string;
}

function formatNote(entry: NoteEntry): string {
  const date = new Date().toISOString().slice(0, 10);
  return ["", `## ${date} — ${entry.topic ?? "Note"}`, "", entry.note, ""].join("\n");
}

export async function saveNote(entry: NoteEntry): Promise<void> {
  const text = formatNote(entry);

  if (useGithubStore()) {
    await appendToRepoFile(NOTES_FILE, text, `chore: save note — ${entry.topic ?? "note"}`);
    return;
  }

  appendFileSync(join(getRoot(), NOTES_FILE), text);
}
