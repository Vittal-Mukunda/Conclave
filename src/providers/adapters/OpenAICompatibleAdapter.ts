import { HttpRequest } from '../http';
import { ChatRequest, FinishReason, Provider } from '../types';
import { emptyResponseError, malformedResponseError, refusalError } from '../errors';
import { AdapterParseResult, ChatAdapter, StreamDelta } from './ChatAdapter';

// Default adapter for the many providers that speak the OpenAI /chat/completions
// wire format (Groq, OpenRouter, Cerebras, Mistral, DeepSeek, GitHub Models,
// Gemini's OpenAI-compatible endpoint, and OpenAI itself).
export class OpenAICompatibleAdapter implements ChatAdapter {
  readonly kind = 'openai' as const;

  buildRequest(provider: Provider, apiKey: string, req: ChatRequest, stream: boolean): HttpRequest {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.stop && req.stop.length) body.stop = req.stop;

    return {
      url: `${trimSlash(provider.baseURL)}/chat/completions`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    };
  }

  parseResponse(provider: Provider, json: unknown): AdapterParseResult {
    if (!json || typeof json !== 'object') {
      throw malformedResponseError(provider);
    }
    const choices = (json as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw emptyResponseError(provider);
    }
    const choice = choices[0] as {
      message?: { content?: unknown };
      finish_reason?: string;
    };
    const finishReason = mapFinish(choice.finish_reason);
    if (finishReason === 'content_filter') {
      throw refusalError(provider);
    }
    const text = typeof choice.message?.content === 'string' ? choice.message.content : '';
    if (text.trim() === '' && finishReason !== 'length') {
      throw emptyResponseError(provider);
    }
    const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    return {
      text,
      finishReason,
      tokensIn: usage?.prompt_tokens,
      tokensOut: usage?.completion_tokens,
      raw: json,
    };
  }

  parseStreamEvent(data: string): StreamDelta | null {
    if (data === '[DONE]') {
      return { done: true };
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return null; // skip an unparsable keep-alive line
    }
    const choice = (json as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }> })
      .choices?.[0];
    if (!choice) {
      return null;
    }
    const delta: StreamDelta = {};
    if (typeof choice.delta?.content === 'string') {
      delta.textDelta = choice.delta.content;
    }
    if (choice.finish_reason) {
      delta.finishReason = mapFinish(choice.finish_reason);
      delta.done = true;
    }
    const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    if (usage) {
      delta.tokensIn = usage.prompt_tokens;
      delta.tokensOut = usage.completion_tokens;
    }
    return delta;
  }
}

function mapFinish(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
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
