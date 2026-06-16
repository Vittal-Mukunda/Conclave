import { Logger } from '../logging/Logger';
import { SecretRedactor } from '../logging/redaction';
import { getAdapter } from './registry';
import { FetchTransport, HttpResponse, HttpTransport, TransportError } from './http';
import {
  malformedResponseError,
  mapHttpError,
  mapTransportError,
  missingKeyError,
  streamDroppedError,
} from './errors';
import { estimateMessagesTokens, estimateTokens } from './tokenEstimate';
import { parseRetryAfterMs } from '../scheduler/backoff';
import { ChatOptions, ChatRequest, ChatResponse, FinishReason, Provider } from './types';

export type KeyProvider = (providerId: string) => Promise<string | undefined>;

export interface LLMClientDeps {
  transport?: HttpTransport;
  keyProvider: KeyProvider;
  redactor?: SecretRedactor;
  logger?: Logger;
  now?: () => number;
  defaultTimeoutMs?: number;
}

/**
 * Issues chat completions to any registered provider via its adapter. Every
 * failure — transport, HTTP, malformed/empty/refusal, dropped stream — is mapped
 * to a typed ConclaveError on the Phase 1 taxonomy. The API key is registered
 * with the redactor before use so it can never appear in any log.
 *
 * NOTE: this client is the raw transport. Rate limiting, retries and failover
 * are added by the scheduler in Phase 3; this layer only classifies failures.
 */
export class LLMClient {
  private readonly transport: HttpTransport;
  private readonly now: () => number;
  private readonly defaultTimeoutMs: number;

  constructor(private readonly deps: LLMClientDeps) {
    this.transport = deps.transport ?? new FetchTransport();
    this.now = deps.now ?? (() => Date.now());
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? 60000;
  }

  async chat(provider: Provider, req: ChatRequest, opts: ChatOptions = {}): Promise<ChatResponse> {
    const apiKey = await this.deps.keyProvider(provider.id);
    if (!apiKey) {
      throw missingKeyError(provider);
    }
    // The key is now in play — make sure it can never leak into a log/report.
    this.deps.redactor?.registerSecret(apiKey);

    const adapter = getAdapter(provider.adapter);
    const stream = opts.stream ?? false;
    const httpReq = adapter.buildRequest(provider, apiKey, req, stream);

    const start = this.now();
    let res: HttpResponse;
    try {
      res = await this.transport.send(httpReq, {
        stream,
        timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof TransportError) {
        throw mapTransportError(err, provider);
      }
      throw err;
    }

    if (!res.ok) {
      const body = await safeText(res);
      const retryAfterMs =
        res.status === 429 ? parseRetryAfterMs(res.header('retry-after'), this.now()) : undefined;
      throw mapHttpError(res.status, provider, body, retryAfterMs);
    }

    return stream
      ? this.consumeStream(provider, req, res, start, opts)
      : this.consumeJson(provider, req, res, start);
  }

  private async consumeJson(
    provider: Provider,
    req: ChatRequest,
    res: HttpResponse,
    start: number,
  ): Promise<ChatResponse> {
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw malformedResponseError(provider, err);
    }
    const adapter = getAdapter(provider.adapter);
    const parsed = adapter.parseResponse(provider, json); // throws on empty/refusal
    const estimated = parsed.tokensIn === undefined || parsed.tokensOut === undefined;
    return {
      text: parsed.text,
      tokensIn: parsed.tokensIn ?? estimateMessagesTokens(req.messages),
      tokensOut: parsed.tokensOut ?? estimateTokens(parsed.text),
      finishReason: parsed.finishReason,
      latencyMs: this.now() - start,
      model: req.model,
      provider: provider.id,
      estimatedTokens: estimated,
      raw: parsed.raw,
    };
  }

  private async consumeStream(
    provider: Provider,
    req: ChatRequest,
    res: HttpResponse,
    start: number,
    opts: ChatOptions,
  ): Promise<ChatResponse> {
    const adapter = getAdapter(provider.adapter);
    let text = '';
    let finishReason: FinishReason | undefined;
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let sawDone = false;

    for await (const line of res.lines()) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith(':') || trimmed.startsWith('event:')) {
        continue;
      }
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      const data = trimmed.slice('data:'.length).trim();
      const delta = adapter.parseStreamEvent(data);
      if (!delta) {
        continue;
      }
      if (delta.textDelta) {
        text += delta.textDelta;
        opts.onToken?.(delta.textDelta);
      }
      if (delta.finishReason) finishReason = delta.finishReason;
      if (delta.tokensIn !== undefined) tokensIn = delta.tokensIn;
      if (delta.tokensOut !== undefined) tokensOut = delta.tokensOut;
      if (delta.done) {
        sawDone = true;
        break;
      }
    }

    // The stream ended without a terminal event => dropped. Discard the partial
    // (no partial commit) and raise a typed, retryable error.
    if (!sawDone && finishReason === undefined) {
      throw streamDroppedError(provider);
    }

    const estimated = tokensIn === undefined || tokensOut === undefined;
    return {
      text,
      tokensIn: tokensIn ?? estimateMessagesTokens(req.messages),
      tokensOut: tokensOut ?? estimateTokens(text),
      finishReason: finishReason ?? 'stop',
      latencyMs: this.now() - start,
      model: req.model,
      provider: provider.id,
      estimatedTokens: estimated,
    };
  }
}

async function safeText(res: HttpResponse): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
