import { readSkill, listSkills } from "./tools/run_skill";
import { readContext, logDecision, saveNote, listContextFiles } from "./tools/context_tools";
import { getProvider } from "./providers";
import type { AgentMessage, Provider, ToolDef } from "./providers";
import { getSelectedProvider } from "./lib/model_config";

// The /model switcher persists a provider choice in the context repo; it wins
// over the LLM_PROVIDER env default when set and valid.
async function resolveProvider(): Promise<Provider> {
  return getProvider((await getSelectedProvider()) ?? undefined);
}

const SYSTEM_PROMPT = `You are Terry's personal AI assistant, reachable via Telegram.
Terry is a full-time software engineer upskilling in SE and AI, targeting a new job by September 2026.
Be concise — this is a mobile chat. Keep responses under 800 characters unless the skill genuinely requires more.
When executing a skill document, follow its instructions and produce a useful response based on Terry's context.
For freeform chat, use the read_context tool when a question needs real information about Terry rather than a
generic answer, use log_decision when Terry states he has made or is making a decision, and use save_note
when Terry asks to remember or note something (or shares a learning worth keeping) that isn't a decision.`;

const MAX_TOOL_ITERATIONS = 4;

const TOOLS: ToolDef[] = [
  {
    name: "read_context",
    description:
      "Read one of Terry's AIOS context files to ground a response in his actual priorities, business context, past decisions, or writing voice.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          enum: listContextFiles(),
          description: "Which context file to read.",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "log_decision",
    description:
      "Append a decision to Terry's decisions log. Use when Terry states he has made or is making a decision, so it gets recorded with its reasoning.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the decision." },
        decision: { type: "string", description: "What was decided." },
        why: { type: "string", description: "The reasoning behind it." },
        alternatives: { type: "string", description: "What else was considered, if mentioned." },
      },
      required: ["title", "decision", "why"],
    },
  },
  {
    name: "save_note",
    description:
      "Save a general note or learning to Terry's notes file. Use when Terry asks to remember something, or shares an insight worth keeping, that isn't a decision (decisions go to log_decision).",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "The note text to save." },
        topic: { type: "string", description: "Short topic heading for the note, if clear." },
      },
      required: ["note"],
    },
  },
];

async function executeTool(
  name: string,
  input: any
): Promise<{ content: string; isError: boolean }> {
  if (name === "read_context") {
    const result = await readContext(input.file);
    return result
      ? { content: result, isError: false }
      : { content: `File not found or not allowed: ${input.file}`, isError: true };
  }

  if (name === "log_decision") {
    await logDecision({
      title: input.title,
      decision: input.decision,
      why: input.why,
      ...(input.alternatives ? { alternatives: input.alternatives } : {}),
    });
    return { content: "Decision logged.", isError: false };
  }

  if (name === "save_note") {
    await saveNote({
      note: input.note,
      ...(input.topic ? { topic: input.topic } : {}),
    });
    return { content: "Note saved.", isError: false };
  }

  return { content: `Unknown tool: ${name}`, isError: true };
}

async function runToolLoop(text: string): Promise<string> {
  const provider = await resolveProvider();
  const messages: AgentMessage[] = [{ role: "user", text }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const turn = await provider.complete({
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      maxTokens: 1024,
    });

    if (turn.toolCalls.length === 0) {
      return turn.text ?? "No response generated.";
    }

    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });

    const results = [];
    for (const call of turn.toolCalls) {
      const { content, isError } = await executeTool(call.name, call.input);
      results.push({ id: call.id, content, isError });
    }
    messages.push({ role: "tool_results", results });
  }

  return "I wasn't able to finish that after a few tool calls — try rephrasing?";
}

export async function processMessage(text: string): Promise<string> {
  if (text.trim() === "/skills") {
    const skills = await listSkills();
    return `Available skills:\n${skills.map((s) => `/${s}`).join("\n")}`;
  }

  if (text.startsWith("/")) {
    const skillName = (text.slice(1).split(" ")[0] ?? "").toLowerCase();
    const skillContent = await readSkill(skillName);

    if (!skillContent) {
      const skills = await listSkills();
      return `Unknown skill "/${skillName}". Available:\n${skills.map((s) => `/${s}`).join(", ")}`;
    }

    const turn = await (await resolveProvider()).complete({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          text: `Execute the following skill and produce a concise, useful response for Terry.\n\n---\n${skillContent}`,
        },
      ],
      maxTokens: 2048,
    });

    return turn.text ?? "No response generated.";
  }

  // Freeform chat — real tool-use loop
  return runToolLoop(text);
}
