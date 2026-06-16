// Phase 15 — outbound content secret scanner (SEC-1). Complements the Phase 1
// SecretRedactor: that one strips *known live* keys (the registry) and obvious
// shapes from logs/reports (SEC-4); this one scans arbitrary REPO CONTENT bound
// for a provider prompt and catches credentials we have never seen — PEM blocks,
// JWTs, cloud keys, and `secret = "..."` assignments — redacting them before they
// leave the machine and reporting what was found so the user can be warned.

export type SecretType =
  | 'openai-key'
  | 'anthropic-key'
  | 'google-key'
  | 'github-token'
  | 'groq-key'
  | 'aws-access-key'
  | 'slack-token'
  | 'private-key'
  | 'jwt'
  | 'bearer'
  | 'assigned-secret';

interface Rule {
  type: SecretType;
  re: RegExp;
  /** When set, only capture-group `group` is the secret (the rest is context). */
  group?: number;
}

// Order matters: most specific first so a key isn't double-matched by `bearer`.
const RULES: Rule[] = [
  { type: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: 'openai-key', re: /sk-[A-Za-z0-9]{20,}/g },
  { type: 'google-key', re: /AIza[0-9A-Za-z_-]{30,}/g },
  { type: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { type: 'groq-key', re: /gsk_[A-Za-z0-9]{20,}/g },
  { type: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { type: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { type: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { type: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { type: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
  {
    type: 'assigned-secret',
    re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?([^'"\s]{8,})['"]?/gi,
    group: 1,
  },
];

export interface SecretFinding {
  type: SecretType;
  count: number;
}

export interface ScanResult {
  /** Input with every secret replaced by a typed placeholder. */
  redacted: string;
  findings: SecretFinding[];
  /** Total secrets found. >0 means do NOT send the raw text. */
  total: number;
}

const PLACEHOLDER = (t: SecretType) => `«redacted:${t}»`;

/** Scan text for secrets and return a redacted copy + a finding summary. */
export function scanSecrets(text: string): ScanResult {
  const counts = new Map<SecretType, number>();
  let redacted = text;

  for (const rule of RULES) {
    redacted = redacted.replace(rule.re, (match, ...groups) => {
      counts.set(rule.type, (counts.get(rule.type) ?? 0) + 1);
      if (rule.group !== undefined) {
        const secret = groups[rule.group - 1] as string;
        // Preserve the `key =` prefix; redact only the value.
        return match.replace(secret, PLACEHOLDER(rule.type));
      }
      return PLACEHOLDER(rule.type);
    });
  }

  const findings = [...counts.entries()].map(([type, count]) => ({ type, count }));
  const total = findings.reduce((s, f) => s + f.count, 0);
  return { redacted, findings, total };
}

/** True if the text contains no key-shaped substring after redaction (SEC-4). */
export function containsNoSecret(text: string): boolean {
  return scanSecrets(text).total === 0;
}
