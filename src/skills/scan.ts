import { detectInjection } from '../security/injection';
import { RiskLevel, ScanFinding, ScanResult } from './types';

// Static + supply-chain scan run on skill ingest (docs/skills-spec.md SECURITY).
// Downloaded skills are UNTRUSTED CODE. The scanner flags prompt-injection in
// instructions, outbound network calls, secret/file access, dangerous exec, and
// SOURCE/BYTECODE MISMATCH (.py vs .pyc). It is PLUGGABLE (a real Cisco-style
// scanner can be added) but is NEVER trusted alone — scanners are evadable, so
// the scripts-off-by-default trust posture (trust.ts) is the backstop (SKILL-3).
// A high-risk result blocks ingest; the skill is never auto-run (SKILL-2).

const RANK: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };

function highest(findings: ScanFinding[]): RiskLevel {
  return findings.reduce<RiskLevel>((max, f) => (RANK[f.severity] > RANK[max] ? f.severity : max), 'none');
}

const SCRIPT_EXT = /\.(py|sh|bash|zsh|js|cjs|mjs|ts|rb|pl|ps1)$/i;

interface PatternRule {
  id: string;
  severity: RiskLevel;
  re: RegExp;
  detail: string;
}

// Patterns scanned in any script/text file (beyond SKILL.md instructions).
const CODE_RULES: PatternRule[] = [
  {
    id: 'secret-file-access',
    severity: 'high',
    re: /(~\/\.ssh|\bid_rsa\b|\/etc\/passwd|\.aws\/credentials|\.env\b|\bnetrc\b)/i,
    detail: 'reads a credential/secret file path',
  },
  {
    id: 'env-exfiltration',
    severity: 'medium',
    re: /\b(process\.env|os\.environ|getenv)\b/i,
    detail: 'reads environment variables (possible secret access)',
  },
  {
    id: 'dangerous-exec',
    severity: 'high',
    re: /\b(eval|exec|os\.system|subprocess\.|child_process|pickle\.loads|marshal\.loads)\b|Function\s*\(/,
    detail: 'executes dynamic/shell code',
  },
  {
    id: 'outbound-network',
    severity: 'medium',
    re: /\b(requests\.|urllib|http\.client|axios|node-fetch|fetch\(|\bcurl\b|\bwget\b|socket\.)/i,
    detail: 'makes an outbound network call',
  },
];

/** A pluggable scanner (e.g. an external SAST tool). Returns extra findings. */
export interface ScannerPlugin {
  name: string;
  scan(files: Record<string, string>): ScanFinding[];
}

function isScript(path: string): boolean {
  return SCRIPT_EXT.test(path) || path.startsWith('scripts/');
}

/** Built-in static scan over a skill folder's files. */
function builtInScan(files: Record<string, string>): ScanFinding[] {
  const findings: ScanFinding[] = [];

  // 1. Prompt-injection in any instruction/markdown file (incl. SKILL.md).
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.md') || path === 'SKILL.md') {
      const inj = detectInjection(content);
      for (const f of inj.findings) {
        findings.push({
          id: `prompt-injection:${f.id}`,
          severity: 'high',
          file: path,
          detail: `prompt-injection pattern "${f.id}"`,
        });
      }
    }
  }

  // 2. Dangerous-code patterns in scripts.
  for (const [path, content] of Object.entries(files)) {
    if (!isScript(path)) {
      continue;
    }
    for (const rule of CODE_RULES) {
      if (rule.re.test(content)) {
        findings.push({ id: rule.id, severity: rule.severity, file: path, detail: rule.detail });
      }
    }
  }

  // 3. Source/bytecode mismatch — shipped .pyc is a supply-chain red flag (SKILL-3).
  for (const path of Object.keys(files)) {
    if (path.endsWith('.pyc')) {
      const src = path.replace(/\.pyc$/, '.py');
      const hasSrc = Object.prototype.hasOwnProperty.call(files, src);
      findings.push({
        id: hasSrc ? 'bytecode-present' : 'source-bytecode-mismatch',
        severity: 'high',
        file: path,
        detail: hasSrc
          ? 'ships compiled .pyc alongside source (unnecessary; possible poisoned bytecode)'
          : 'ships .pyc with NO matching .py source (cannot audit — likely evasion)',
      });
    }
  }

  return findings;
}

export class SkillScanner {
  constructor(private readonly plugins: ScannerPlugin[] = []) {}

  scan(files: Record<string, string>): ScanResult {
    const findings = [...builtInScan(files)];
    for (const p of this.plugins) {
      try {
        findings.push(...p.scan(files));
      } catch {
        // A misbehaving plugin must never crash ingest; its findings are skipped.
      }
    }
    const risk = highest(findings);
    return { risk, findings, clean: RANK[risk] < RANK.medium };
  }
}
