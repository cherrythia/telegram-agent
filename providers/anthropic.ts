import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentMessage,
  AssistantTurn,
  CompletionRequest,
  Provider,
  ToolCall,
} from "./types";

function toAnthropicMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === "user") {
      return { role: "user", content: m.text };
    }
    if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.text) blocks.push({ type: "text", text: m.text });
      for (const call of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      return { role: "assistant", content: blocks };
    }
    return {
      role: "user",
      content: m.results.map(
        (r): Anthropic.ToolResultBlockParam => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.content,
          is_error: r.isError,
        })
      ),
    };
  });
}

export class AnthropicProvider implements Provider {
  private client: Anthropic;
  private model: string;

  constructor(model: string) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = model;
  }

  async complete(req: CompletionRequest): Promise<AssistantTurn> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      ...(req.tools?.length
        ? {
            tools: req.tools.map(
              (t): Anthropic.Tool => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })
            ),
          }
        : {}),
      messages: toAnthropicMessages(req.messages),
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const toolCalls: ToolCall[] = response.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));

    return {
      text: textBlock && textBlock.type === "text" ? textBlock.text : undefined,
      toolCalls: response.stop_reason === "tool_use" ? toolCalls : [],
    };
  }
}
