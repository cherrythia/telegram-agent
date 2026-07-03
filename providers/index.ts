import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai_compatible";
import type { Provider } from "./types";

export type { AgentMessage, AssistantTurn, Provider, ToolCall, ToolDef, ToolResult } from "./types";

interface OpenAICompatConfig {
  baseUrl: string;
  keyEnv: string;
  defaultModel: string;
}

const OPENAI_COMPAT: Record<string, OpenAICompatConfig> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash",
  },
};

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

let cached: { key: string; provider: Provider } | null = null;

export function getProvider(): Provider {
  const name = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  const model = process.env.LLM_MODEL;
  const cacheKey = `${name}:${model ?? ""}`;
  if (cached?.key === cacheKey) return cached.provider;

  let provider: Provider;
  if (name === "anthropic") {
    provider = new AnthropicProvider(model ?? DEFAULT_ANTHROPIC_MODEL);
  } else {
    const config = OPENAI_COMPAT[name];
    if (!config) {
      throw new Error(
        `Unknown LLM_PROVIDER "${name}". Supported: anthropic, ${Object.keys(OPENAI_COMPAT).join(", ")}`
      );
    }
    const apiKey = process.env[config.keyEnv];
    if (!apiKey) throw new Error(`${config.keyEnv} is not set (required for LLM_PROVIDER=${name})`);
    provider = new OpenAICompatibleProvider(config.baseUrl, apiKey, model ?? config.defaultModel);
  }

  cached = { key: cacheKey, provider };
  return provider;
}
