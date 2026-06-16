import { HttpRequest } from '../http';
import { ChatRequest, FinishReason, Provider } from '../types';

export interface AdapterParseResult {
  text: string;
  finishReason: FinishReason;
  /** Reported usage, if the provider supplied it. */
  tokensIn?: number;
  tokensOut?: number;
  raw: unknown;
}

export interface StreamDelta {
  textDelta?: string;
  finishReason?: FinishReason;
  tokensIn?: number;
  tokensOut?: number;
  /** Terminal event — the stream completed cleanly. */
  done?: boolean;
}

/**
 * Per-provider request building and response parsing. The OpenAI-compatible
 * adapter is the default; dedicated adapters exist where the wire format differs
 * (e.g. Anthropic). Adapters are pure: they build/parse, never do IO.
 */
export interface ChatAdapter {
  readonly kind: 'openai' | 'anthropic';
  buildRequest(provider: Provider, apiKey: string, req: ChatRequest, stream: boolean): HttpRequest;
  /** Parse a 2xx JSON body. MUST throw a ConclaveError for empty/malformed/refusal. */
  parseResponse(provider: Provider, json: unknown): AdapterParseResult;
  /** Parse one SSE `data:` payload (already stripped of the prefix). */
  parseStreamEvent(data: string): StreamDelta | null;
}
