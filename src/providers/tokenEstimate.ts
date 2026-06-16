import { ChatMessage } from './types';

// Rough token estimate used as a fallback when a provider returns no usage
// numbers. ~4 chars per token is the common heuristic; we add a small per-
// message overhead for role/format framing. Never authoritative — the telemetry
// layer (Phase 4) prefers reported usage and flags estimates.
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4;

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content) + PER_MESSAGE_OVERHEAD;
  }
  return total;
}
