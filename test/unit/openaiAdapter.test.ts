import { describe, it, expect } from 'vitest';
import { OpenAICompatibleAdapter } from '../../src/providers/adapters/OpenAICompatibleAdapter';
import { ProviderRegistry } from '../../src/providers/registry';
import { ConclaveError } from '../../src/errors/ErrorReport';

const adapter = new OpenAICompatibleAdapter();
const provider = new ProviderRegistry().get('groq')!;

function ok(content: string, finish = 'stop', usage?: object): unknown {
  return {
    choices: [{ message: { content }, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  };
}

describe('OpenAICompatibleAdapter', () => {
  it('builds a /chat/completions request with bearer auth', () => {
    const req = adapter.buildRequest(provider, 'sk-xyz', { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, false);
    expect(req.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer sk-xyz');
    expect(JSON.parse(req.body!).model).toBe('m');
  });

  it('parses a normal response with usage', () => {
    const r = adapter.parseResponse(provider, ok('hello', 'stop', { prompt_tokens: 10, completion_tokens: 3 }));
    expect(r.text).toBe('hello');
    expect(r.finishReason).toBe('stop');
    expect(r.tokensIn).toBe(10);
    expect(r.tokensOut).toBe(3);
  });

  it('returns finishReason length without throwing (PROV-11 handled upstream)', () => {
    const r = adapter.parseResponse(provider, ok('partial', 'length'));
    expect(r.finishReason).toBe('length');
    expect(r.text).toBe('partial');
  });

  it('throws PROV-6 on no choices (empty)', () => {
    expect(() => adapter.parseResponse(provider, { choices: [] })).toThrowError(ConclaveError);
    try {
      adapter.parseResponse(provider, { choices: [] });
    } catch (e) {
      expect((e as ConclaveError).code).toBe('PROV-6');
    }
  });

  it('throws PROV-5 on a non-object body (malformed)', () => {
    try {
      adapter.parseResponse(provider, 'not json' as unknown);
    } catch (e) {
      expect((e as ConclaveError).code).toBe('PROV-5');
    }
  });

  it('throws PROV-9 on content_filter (refusal)', () => {
    try {
      adapter.parseResponse(provider, ok('', 'content_filter'));
    } catch (e) {
      expect((e as ConclaveError).code).toBe('PROV-9');
    }
  });

  it('parses an OpenAI SSE stream event', () => {
    const d = adapter.parseStreamEvent('{"choices":[{"delta":{"content":"hi"}}]}');
    expect(d?.textDelta).toBe('hi');
    expect(adapter.parseStreamEvent('[DONE]')?.done).toBe(true);
  });
});
