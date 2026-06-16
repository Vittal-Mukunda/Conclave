import { describe, it, expect } from 'vitest';
import { LLMClient } from '../../src/providers/LLMClient';
import { HttpRequest, HttpResponse, HttpTransport, SendOptions, TransportError } from '../../src/providers/http';
import { ProviderRegistry } from '../../src/providers/registry';
import { ConclaveError } from '../../src/errors/ErrorReport';
import { SecretRedactor, REDACTION_PLACEHOLDER } from '../../src/logging/redaction';
import { ChatRequest } from '../../src/providers/types';

const registry = new ProviderRegistry();
const groq = registry.get('groq')!;
const anthropic = registry.get('anthropic')!;

const REQ: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

function jsonRes(status: number, body: unknown): HttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
    // eslint-disable-next-line require-yield
    async *lines() {
      return;
    },
  };
}

function malformedRes(): HttpResponse {
  return {
    status: 200,
    ok: true,
    text: async () => '<<garbage',
    json: async () => {
      throw new Error('Unexpected token');
    },
    async *lines() {
      return;
    },
  };
}

function streamRes(lines: string[]): HttpResponse {
  return {
    status: 200,
    ok: true,
    text: async () => '',
    json: async () => {
      throw new Error('not json');
    },
    async *lines() {
      for (const l of lines) {
        yield l;
      }
    },
  };
}

class FakeTransport implements HttpTransport {
  lastReq?: HttpRequest;
  constructor(private readonly responder: HttpResponse | ((req: HttpRequest) => HttpResponse) | Error) {}
  async send(req: HttpRequest, _opts?: SendOptions): Promise<HttpResponse> {
    this.lastReq = req;
    if (this.responder instanceof Error) {
      throw this.responder;
    }
    return typeof this.responder === 'function' ? this.responder(req) : this.responder;
  }
}

function client(transport: HttpTransport, key: string | undefined = 'sk-test', redactor?: SecretRedactor): LLMClient {
  return new LLMClient({ transport, keyProvider: async () => key, redactor, now: () => 1000 });
}

describe('LLMClient (transport classified onto the taxonomy)', () => {
  it('returns a ChatResponse on success with reported usage', async () => {
    const t = new FakeTransport(
      jsonRes(200, { choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 2 } }),
    );
    const res = await client(t).chat(groq, REQ);
    expect(res.text).toBe('hello');
    expect(res.tokensIn).toBe(7);
    expect(res.tokensOut).toBe(2);
    expect(res.finishReason).toBe('stop');
    expect(res.estimatedTokens).toBe(false);
    expect(res.provider).toBe('groq');
  });

  it('estimates tokens when usage is absent', async () => {
    const t = new FakeTransport(jsonRes(200, { choices: [{ message: { content: 'hello there' }, finish_reason: 'stop' }] }));
    const res = await client(t).chat(groq, REQ);
    expect(res.estimatedTokens).toBe(true);
    expect(res.tokensOut).toBeGreaterThan(0);
  });

  it('throws SETUP-1 when no key is configured', async () => {
    const t = new FakeTransport(jsonRes(200, {}));
    const noKeyClient = new LLMClient({ transport: t, keyProvider: async () => undefined, now: () => 1000 });
    await expect(noKeyClient.chat(groq, REQ)).rejects.toMatchObject({ code: 'SETUP-1' });
  });

  it('maps HTTP 404 to PROV-8 (equivalent-model fallback signal)', async () => {
    const t = new FakeTransport(jsonRes(404, { error: 'model not found' }));
    await expect(client(t).chat(groq, REQ)).rejects.toMatchObject({ code: 'PROV-8' });
  });

  it('maps a malformed JSON body to PROV-5 without crashing', async () => {
    const t = new FakeTransport(malformedRes());
    await expect(client(t).chat(groq, REQ)).rejects.toMatchObject({ code: 'PROV-5' });
  });

  it('maps an empty response to PROV-6', async () => {
    const t = new FakeTransport(jsonRes(200, { choices: [] }));
    await expect(client(t).chat(groq, REQ)).rejects.toMatchObject({ code: 'PROV-6' });
  });

  it('maps a refusal to PROV-9', async () => {
    const t = new FakeTransport(jsonRes(200, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }));
    await expect(client(t).chat(groq, REQ)).rejects.toMatchObject({ code: 'PROV-9' });
  });

  it('returns finishReason length rather than throwing (PROV-11)', async () => {
    const t = new FakeTransport(jsonRes(200, { choices: [{ message: { content: 'cut off' }, finish_reason: 'length' }] }));
    const res = await client(t).chat(groq, REQ);
    expect(res.finishReason).toBe('length');
  });

  it('maps a transport timeout to PROV-4', async () => {
    const t = new FakeTransport(new TransportError('timeout', 'timeout'));
    await expect(client(t).chat(groq, REQ)).rejects.toMatchObject({ code: 'PROV-4' });
  });

  it('aggregates a streamed response', async () => {
    const t = new FakeTransport(
      streamRes([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ]),
    );
    const res = await client(t).chat(groq, REQ, { stream: true });
    expect(res.text).toBe('Hello');
    expect(res.finishReason).toBe('stop');
  });

  it('throws PROV-12 and commits nothing when a stream drops', async () => {
    const t = new FakeTransport(
      streamRes(['data: {"choices":[{"delta":{"content":"Par"}}]}', 'data: {"choices":[{"delta":{"content":"tial"}}]}']),
    );
    await expect(client(t).chat(groq, REQ, { stream: true })).rejects.toMatchObject({ code: 'PROV-12' });
  });

  it('round-trips through the Anthropic adapter', async () => {
    const t = new FakeTransport(
      jsonRes(200, { content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 1 } }),
    );
    const res = await client(t).chat(anthropic, { model: 'claude-3-5-sonnet-latest', messages: REQ.messages });
    expect(res.text).toBe('pong');
    expect(t.lastReq?.headers['x-api-key']).toBe('sk-test');
  });

  it('registers the API key with the redactor (SEC-4)', async () => {
    const redactor = new SecretRedactor();
    const t = new FakeTransport(jsonRes(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    await client(t, 'plainkey-no-shape-1', redactor).chat(groq, REQ);
    expect(redactor.redactText('leak plainkey-no-shape-1 here')).toContain(REDACTION_PLACEHOLDER);
    expect(redactor.redactText('leak plainkey-no-shape-1 here')).not.toContain('plainkey-no-shape-1');
  });

  it('is a ConclaveError on every failure path', async () => {
    const t = new FakeTransport(jsonRes(500, {}));
    await expect(client(t).chat(groq, REQ)).rejects.toBeInstanceOf(ConclaveError);
  });
});
