// Provider + chat model types. All vscode-free so the registry, adapters and
// client are unit-testable with an injected transport.

export type ProviderKind = 'free' | 'paid';
export type AdapterKind = 'openai' | 'anthropic';
export type AuthStyle = 'bearer' | 'x-api-key';

export interface ModelInfo {
  id: string;
  contextWindow?: number;
  /** USD per 1M input tokens. 0 for free-tier models. */
  inputPricePerMTok?: number;
  /** USD per 1M output tokens. 0 for free-tier models. */
  outputPricePerMTok?: number;
  capabilities?: string[]; // 'code' | 'reasoning' | 'tools' | 'vision' | ...
}

export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  baseURL: string;
  adapter: AdapterKind;
  authStyle: AuthStyle;
  defaultModels: ModelInfo[];
  /** Where the user obtains a key (shown as "Get key ->"). */
  keyUrl?: string;
  /** Informational notes (e.g. geo restrictions). */
  notes?: string;
}

export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

export type FinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'error'
  | 'unknown';

export interface ChatResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  finishReason: FinishReason;
  latencyMs: number;
  model: string;
  provider: string;
  /** True when token counts were estimated (provider returned no usage). */
  estimatedTokens: boolean;
  raw?: unknown;
}

export interface ChatOptions {
  stream?: boolean;
  /** Called with each text delta while streaming. */
  onToken?: (delta: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Which pooled account's key to use (Phase 21). Defaults to 'default'. */
  accountId?: string;
}
