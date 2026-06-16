import { HttpRequest } from '../http';
import { ChatRequest, FinishReason, Provider } from '../types';
import { emptyResponseError, malformedResponseError, refusalError } from '../errors';
import { AdapterParseResult, ChatAdapter, StreamDelta } from './ChatAdapter';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

// Dedicated adapter for the Anthropic Messages API, which differs from OpenAI:
// x-api-key auth, anthropic-version header, system prompt as a top-level field,
// content as typed blocks, and stop_reason instead of finish_reason.
export class AnthropicAdapter implements ChatAdapter {
  readonly kind = 'anthropic' as const;

  buildRequest(provider: Provider, apiKey: string, req: ChatRequest, stream: boolean): HttpRequest {
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      stream,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.stop && req.stop.length) body.stop_sequences = req.stop;

    return {
      url: `${trimSlash(provider.baseURL)}/v1/messages`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    };
  }

  parseResponse(provider: Provider, json: unknown): AdapterParseResult {
    if (!json || typeof json !== 'object') {
      throw malformedResponseError(provider);
    }
    const obj = json as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (!Array.isArray(obj.content)) {
      throw emptyResponseError(provider);
    }
    const finishReason = mapStop(obj.stop_reason);
    if (finishReason === 'content_filter') {
      throw refusalError(provider);
    }
    const text = obj.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    if (text.trim() === '' && finishReason !== 'length') {
      throw emptyResponseError(provider);
    }
    return {
      text,
      finishReason,
      tokensIn: obj.usage?.input_tokens,
      tokensOut: obj.usage?.output_tokens,
      raw: json,
    };
  }

  parseStreamEvent(data: string): StreamDelta | null {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return null;
    }
    const evt = json as {
      type?: string;
      delta?: { type?: string; text?: string; stop_reason?: string };
      message?: { usage?: { input_tokens?: number } };
      usage?: { output_tokens?: number };
    };
    switch (evt.type) {
      case 'message_start':
        return { tokensIn: evt.message?.usage?.input_tokens };
      case 'content_block_delta':
        if (evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
          return { textDelta: evt.delta.text };
        }
        return null;
      case 'message_delta':
        return {
          finishReason: evt.delta?.stop_reason ? mapStop(evt.delta.stop_reason) : undefined,
          tokensOut: evt.usage?.output_tokens,
        };
      case 'message_stop':
        return { done: true };
      default:
        return null;
    }
  }
}

function mapStop(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    case undefined:
    case null:
      return 'stop';
    default:
      return 'unknown';
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
