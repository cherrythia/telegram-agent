export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | { role: "tool_results"; results: ToolResult[] };

export interface CompletionRequest {
  system: string;
  messages: AgentMessage[];
  tools?: ToolDef[];
  maxTokens: number;
}

export interface AssistantTurn {
  text?: string;
  toolCalls: ToolCall[];
}

export interface Provider {
  complete(req: CompletionRequest): Promise<AssistantTurn>;
}
