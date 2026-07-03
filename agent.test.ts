import { test, expect, mock, beforeEach } from "bun:test";

const mockCreate = mock((..._args: any[]): Promise<any> =>
  Promise.resolve({
    content: [{ type: "text", text: "Mock Claude response" }],
    stop_reason: "end_turn",
  })
);

mock.module("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: mockCreate };
  },
}));

// Mock skill reader
mock.module("./tools/run_skill", () => ({
  readSkill: (name: string) =>
    name === "audit" ? "# Audit Skill\nRun an audit." : null,
  listSkills: () => ["audit", "level-up", "retro"],
}));

const mockReadContext = mock((file: string) =>
  file === "context/priorities.md" ? "# Priorities\n1. Ship things." : null
);
const mockLogDecision = mock(() => {});
const mockSaveNote = mock(() => {});

mock.module("./tools/context_tools", () => ({
  readContext: mockReadContext,
  logDecision: mockLogDecision,
  saveNote: mockSaveNote,
  listContextFiles: () => ["context/priorities.md", "decisions/log.md"],
}));

// Cache-busted import: server.test.ts registers mock.module("./agent"), and Bun
// module mocks are process-global across test files — a plain import here would
// receive that mock when the full suite runs.
const { processMessage } = await import("./agent?" + Math.random());

beforeEach(() => {
  mockCreate.mockClear();
  mockReadContext.mockClear();
  mockLogDecision.mockClear();
  mockSaveNote.mockClear();
  mockCreate.mockImplementation(() =>
    Promise.resolve({
      content: [{ type: "text", text: "Mock Claude response" }],
      stop_reason: "end_turn",
    })
  );
});

test("processMessage: /skills returns list of available skills", async () => {
  const result = await processMessage("/skills");
  expect(result).toContain("/audit");
  expect(result).toContain("/level-up");
  expect(result).toContain("/retro");
});

test("processMessage: /audit calls Claude with skill content in prompt", async () => {
  await processMessage("/audit");
  expect(mockCreate).toHaveBeenCalledTimes(1);
  const call = mockCreate.mock.calls[0]![0];
  expect(call.messages[0].content).toContain("# Audit Skill");
});

test("processMessage: unknown skill returns helpful error", async () => {
  const result = await processMessage("/nonexistent");
  expect(result).toContain("Unknown skill");
  expect(result).toContain("/audit");
});

test("processMessage: freeform text calls Claude without skill content", async () => {
  await processMessage("What should I work on today?");
  expect(mockCreate).toHaveBeenCalledTimes(1);
  const call = mockCreate.mock.calls[0]![0];
  expect(call.messages[0].content).toBe("What should I work on today?");
});

test("processMessage: /AUDIT is case-insensitive", async () => {
  await processMessage("/AUDIT");
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test("processMessage: freeform text with no tool use returns text after a single call", async () => {
  mockCreate.mockImplementationOnce(() =>
    Promise.resolve({
      content: [{ type: "text", text: "Plain answer" }],
      stop_reason: "end_turn",
    })
  );

  const result = await processMessage("What should I work on today?");

  expect(result).toBe("Plain answer");
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test("processMessage: executes read_context tool and feeds the result back for a final answer", async () => {
  mockCreate
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_context",
            input: { file: "context/priorities.md" },
          },
        ],
        stop_reason: "tool_use",
      })
    )
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [{ type: "text", text: "Your top priority is shipping things." }],
        stop_reason: "end_turn",
      })
    );

  const result = await processMessage("What are my priorities?");

  expect(mockReadContext).toHaveBeenCalledWith("context/priorities.md");
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(result).toBe("Your top priority is shipping things.");

  const secondCallArgs = mockCreate.mock.calls[1]![0];
  const toolResultMessage = secondCallArgs.messages.find(
    (m: any) => Array.isArray(m.content) && m.content[0]?.type === "tool_result"
  );
  expect(toolResultMessage.content[0].content).toContain("Ship things");
  expect(toolResultMessage.content[0].is_error).toBe(false);
});

test("processMessage: read_context failure is reported back to the model as an error", async () => {
  mockCreate
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: "toolu_3",
            name: "read_context",
            input: { file: "context/missing.md" },
          },
        ],
        stop_reason: "tool_use",
      })
    )
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [{ type: "text", text: "I couldn't find that file." }],
        stop_reason: "end_turn",
      })
    );

  const result = await processMessage("What's in context/missing.md?");

  const secondCallArgs = mockCreate.mock.calls[1]![0];
  const toolResultMessage = secondCallArgs.messages.find(
    (m: any) => Array.isArray(m.content) && m.content[0]?.type === "tool_result"
  );
  expect(toolResultMessage.content[0].is_error).toBe(true);
  expect(result).toBe("I couldn't find that file.");
});

test("processMessage: executes log_decision tool with the model's structured input", async () => {
  mockCreate
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "log_decision",
            input: {
              title: "Use Bun",
              decision: "Use Bun instead of Node.",
              why: "Faster and simpler.",
            },
          },
        ],
        stop_reason: "tool_use",
      })
    )
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [{ type: "text", text: "Logged it." }],
        stop_reason: "end_turn",
      })
    );

  const result = await processMessage(
    "I've decided to use Bun instead of Node, because it's faster and simpler."
  );

  expect(mockLogDecision).toHaveBeenCalledWith({
    title: "Use Bun",
    decision: "Use Bun instead of Node.",
    why: "Faster and simpler.",
  });
  expect(result).toBe("Logged it.");
});

test("processMessage: executes save_note tool with the model's structured input", async () => {
  mockCreate
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: "toolu_5",
            name: "save_note",
            input: {
              note: "Cloud Run freezes CPU after the response is sent.",
              topic: "Cloud Run gotcha",
            },
          },
        ],
        stop_reason: "tool_use",
      })
    )
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [{ type: "text", text: "Saved it." }],
        stop_reason: "end_turn",
      })
    );

  const result = await processMessage(
    "Remember this: Cloud Run freezes CPU after the response is sent."
  );

  expect(mockSaveNote).toHaveBeenCalledWith({
    note: "Cloud Run freezes CPU after the response is sent.",
    topic: "Cloud Run gotcha",
  });
  expect(result).toBe("Saved it.");
});

test("processMessage: unknown tool name from the model doesn't crash the loop", async () => {
  mockCreate
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [{ type: "tool_use", id: "toolu_4", name: "delete_everything", input: {} }],
        stop_reason: "tool_use",
      })
    )
    .mockImplementationOnce(() =>
      Promise.resolve({
        content: [{ type: "text", text: "I can't do that." }],
        stop_reason: "end_turn",
      })
    );

  const result = await processMessage("Delete everything");
  expect(result).toBe("I can't do that.");
});

test("processMessage: caps the tool-use loop instead of looping forever", async () => {
  mockCreate.mockImplementation(() =>
    Promise.resolve({
      content: [
        {
          type: "tool_use",
          id: "toolu_loop",
          name: "read_context",
          input: { file: "context/priorities.md" },
        },
      ],
      stop_reason: "tool_use",
    })
  );

  const result = await processMessage("Keep reading forever");

  expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(4);
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});
