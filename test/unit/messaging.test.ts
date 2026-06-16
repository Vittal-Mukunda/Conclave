import { describe, it, expect } from 'vitest';
import { handleWebviewMessage } from '../../src/messaging';

describe('handleWebviewMessage', () => {
  it('replies pong to a ping and echoes the correlation id', () => {
    const reply = handleWebviewMessage({ type: 'ping', id: 'abc-123' });
    expect(reply).not.toBeNull();
    expect(reply?.type).toBe('pong');
    expect(reply?.id).toBe('abc-123');
    expect(reply?.payload).toMatchObject({ at: expect.any(Number) });
  });

  it('returns null for unknown message types (forward-compatible)', () => {
    expect(handleWebviewMessage({ type: 'something-future' })).toBeNull();
  });

  it('does not throw on a malformed message', () => {
    // @ts-expect-error intentionally passing a bad shape
    expect(() => handleWebviewMessage(undefined)).not.toThrow();
    // @ts-expect-error intentionally passing a bad shape
    expect(handleWebviewMessage(undefined)).toBeNull();
  });
});
