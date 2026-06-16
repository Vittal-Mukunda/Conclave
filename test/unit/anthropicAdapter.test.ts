import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from '../../src/providers/adapters/AnthropicAdapter';
import { ProviderRegistry } from '../../src/providers/registry';
import { ConclaveError } from '../../src/errors/ErrorReport';

const adapter = new AnthropicAdapter();
const provider = new ProviderRegistry().get('anthropic')!;

describe('AnthropicAdapter (dedicated wire format)', () => {
  it('builds a /v1/messages request with x-api-key + version, system extracted', () => {
    const req = adapter.buildRequest(
      provider,
      'sk-ant-123',
      {
        model: 'claude-3-5-sonnet-latest',
        messages: [
          { role: 'system', content: 'be terse' },
          { role: 'user', content: 'hi' },
        ],
      },
      false,
    );
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-ant-123');
    expect(req.headers['anthropic-version']).toBeTruthy();
    const body = JSON.parse(req.body!);
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.max_tokens).toBeGreaterThan(0); // required field defaulted
  });

  it('round-trips a normal Anthropic response', () => {
    const r = adapter.parseResponse(provider, {
      content: [{ type: 'text', text: 'pong' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 1 },
    });
    expect(r.text).toBe('pong');
    expect(r.finishReason).toBe('stop');
    expect(r.tokensIn).toBe(5);
    expect(r.tokensOut).toBe(1);
  });

  it('maps max_tokens stop_reason to length', () => {
    const r = adapter.parseResponse(provider, {
      content: [{ type: 'text', text: 'cut' }],
      stop_reason: 'max_tokens',
    });
    expect(r.finishReason).toBe('length');
  });

  it('throws PROV-9 on a refusal stop_reason', () => {
    try {
      adapter.parseResponse(provider, { content: [{ type: 'text', text: '' }], stop_reason: 'refusal' });
    } catch (e) {
      expect((e as ConclaveError).code).toBe('PROV-9');
    }
  });

  it('parses streaming content_block_delta + message_stop', () => {
    expect(
      adapter.parseStreamEvent('{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}')?.textDelta,
    ).toBe('x');
    expect(adapter.parseStreamEvent('{"type":"message_stop"}')?.done).toBe(true);
  });
});
