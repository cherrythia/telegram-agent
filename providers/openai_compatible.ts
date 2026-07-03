import type {
  AgentMessage,
  AssistantTurn,
  CompletionRequest,
  Provider,
  ToolCall,
} from "./types";

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

function toWireMessages(system: string, messages: AgentMessage[]): WireMessage[] {
  const wire: WireMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      wire.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      wire.push({
        role: "assistant",
        content: m.text ?? null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map(
                (c): WireToolCall => ({
                  id: c.id,
                  type: "function",
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })
              ),
            }
          : {}),
      });
    } else {
      for (const r of m.results) {
        wire.push({
          role: "tool",
          tool_call_id: r.id,
          content: r.isError ? `Error: ${r.content}` : r.content,
        });
      }
    }
  }
  return wire;
}

export class OpenAICompatibleProvider implements Provider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(req: CompletionRequest): Promise<AssistantTurn> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens,
      messages: toWireMessages(req.system, req.messages),
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new Error(`LLM request failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: WireToolCall[] } }>;
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("LLM response contained no choices");

    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || "{}"),
    }));

    return { text: message.content ?? undefined, toolCalls };
  }
}
