// Secret redaction. MANDATORY before anything is logged, sent to a provider, put
// in an ErrorReport, or surfaced in the UI (invariant: no secret ever leaks).
//
// Two layers:
//   1. A registry of known-live secret strings (the provider layer registers
//      every stored API key here). Exact-substring removal — guarantees a
//      registered key can never appear verbatim, regardless of its shape.
//   2. Shape-based patterns for common key formats, so an un-registered secret
//      pasted into a repo/log is still caught.

export const REDACTION_PLACEHOLDER = '«redacted»';

// Ordered most-specific-first. Each replaces the matched secret with the
// placeholder (Bearer keeps its scheme word for readability).
const PATTERNS: Array<{ re: RegExp; replace: (m: string) => string }> = [
  { re: /Bearer\s+[A-Za-z0-9._\-]{16,}/g, replace: () => `Bearer ${REDACTION_PLACEHOLDER}` },
  { re: /sk-ant-[A-Za-z0-9_\-]{16,}/g, replace: () => REDACTION_PLACEHOLDER },
  { re: /sk-proj-[A-Za-z0-9_\-]{16,}/g, replace: () => REDACTION_PLACEHOLDER },
  { re: /sk-[A-Za-z0-9]{20,}/g, replace: () => REDACTION_PLACEHOLDER },
  { re: /gsk_[A-Za-z0-9]{20,}/g, replace: () => REDACTION_PLACEHOLDER }, // Groq
  { re: /AIza[0-9A-Za-z\-_]{35}/g, replace: () => REDACTION_PLACEHOLDER }, // Google
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/g, replace: () => REDACTION_PLACEHOLDER }, // GitHub
  { re: /xox[baprs]-[A-Za-z0-9\-]{10,}/g, replace: () => REDACTION_PLACEHOLDER }, // Slack
  // key=value / "secret": "value" style assignments. ("authorization" is handled
  // by the Bearer pattern above; including it here would swallow the scheme word.)
  {
    re: /\b(api[_-]?key|apikey|token|secret|password|passwd)\b(\s*["']?\s*[:=]\s*["']?)([^\s"',}]{6,})/gi,
    replace: (m) => m.replace(/([^\s"',}]{6,})$/, REDACTION_PLACEHOLDER),
  },
];

export class SecretRedactor {
  private secrets: string[] = [];

  /** Register a known-live secret (e.g. an API key) for exact removal. */
  registerSecret(value: string): void {
    if (typeof value !== 'string' || value.length < 4) {
      return;
    }
    if (!this.secrets.includes(value)) {
      this.secrets.push(value);
      // Longest first so a key that contains a shorter one is removed entirely.
      this.secrets.sort((a, b) => b.length - a.length);
    }
  }

  unregisterSecret(value: string): void {
    this.secrets = this.secrets.filter((s) => s !== value);
  }

  /** Redact a string: registered secrets first, then shape patterns. */
  redactText(input: string): string {
    let out = input;
    for (const secret of this.secrets) {
      if (secret) {
        out = out.split(secret).join(REDACTION_PLACEHOLDER);
      }
    }
    for (const { re, replace } of PATTERNS) {
      out = out.replace(re, replace);
    }
    return out;
  }

  /** Deep-redact arbitrary values (string leaves get redactText). */
  redact(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.redactText(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.redact(v));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.redact(v);
      }
      return out;
    }
    return value;
  }
}
