import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../../src/scheduler/CircuitBreaker';

describe('CircuitBreaker (open -> half-open -> closed)', () => {
  it('opens after K consecutive failures', () => {
    const b = new CircuitBreaker(3, 1000);
    expect(b.peekAvailable(0)).toBe(true);
    b.onFailure(0);
    b.onFailure(0);
    expect(b.currentState).toBe('closed');
    b.onFailure(0);
    expect(b.currentState).toBe('open');
    expect(b.peekAvailable(0)).toBe(false);
  });

  it('half-opens after cooldown and allows a single probe', () => {
    const b = new CircuitBreaker(1, 1000);
    b.onFailure(0); // open at t=0
    expect(b.peekAvailable(500)).toBe(false);
    expect(b.peekAvailable(1000)).toBe(true); // half-open
    b.confirmDispatch(1000); // take the single probe
    expect(b.peekAvailable(1000)).toBe(false); // no second probe
  });

  it('closes on a successful probe', () => {
    const b = new CircuitBreaker(1, 1000);
    b.onFailure(0);
    b.confirmDispatch(1000);
    b.onSuccess();
    expect(b.currentState).toBe('closed');
    expect(b.peekAvailable(1000)).toBe(true);
  });

  it('re-opens if the probe fails', () => {
    const b = new CircuitBreaker(1, 1000);
    b.onFailure(0);
    b.confirmDispatch(1000);
    b.onFailure(1000);
    expect(b.currentState).toBe('open');
    expect(b.timeUntilHalfOpen(1000)).toBe(1000);
  });
});
