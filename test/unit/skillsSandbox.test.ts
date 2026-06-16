import { describe, it, expect } from 'vitest';
import { SkillExecutionGate, toolAllowed } from '../../src/skills/sandbox';
import { ingestSkill } from '../../src/skills/ingest';
import { SandboxPolicy } from '../../src/security/SandboxPolicy';
import { Skill } from '../../src/skills/types';

function makeSkill(allowedTools: string, scriptsEnabled: boolean): Skill {
  const r = ingestSkill({
    dirName: 'tool-skill',
    trust: 'project',
    source: { source: '/repo/.conclave/skills/tool-skill', sourceType: 'local-project' },
    files: { 'SKILL.md': `---\nname: tool-skill\ndescription: runs things\nallowed-tools: ${allowedTools}\n---\nbody` },
  });
  if (!r.ok) {
    throw new Error('fixture failed');
  }
  return { ...r.skill, scriptsEnabled };
}

describe('toolAllowed (allowed-tools ceiling)', () => {
  it('unscoped entry covers any use of the tool', () => {
    expect(toolAllowed(['Read', 'Bash'], 'Bash')).toBe(true);
  });

  it('scoped entry matches the scope glob', () => {
    expect(toolAllowed(['Bash(git:*)'], 'Bash(git:commit)')).toBe(true);
    expect(toolAllowed(['Bash(git:*)'], 'Bash(rm:rf)')).toBe(false);
  });

  it('no declaration = deny by default', () => {
    expect(toolAllowed(undefined, 'Read')).toBe(false);
    expect(toolAllowed([], 'Read')).toBe(false);
  });
});

describe('SkillExecutionGate', () => {
  it('refuses scripts for an instructions-only skill', () => {
    const skill = makeSkill('Bash(python:*)', false);
    const d = new SkillExecutionGate().decide(skill, { tool: 'Bash(python:run)', kind: 'script' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/instructions-only/);
  });

  it('denies a tool outside the allowed-tools ceiling', () => {
    const skill = makeSkill('Read', true);
    const d = new SkillExecutionGate().decide(skill, { tool: 'Bash(python:run)', kind: 'script' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/allowed-tools ceiling/);
  });

  it('SKILL-7: first script exec requires confirmation; later ones do not', () => {
    const skill = makeSkill('Bash(python:*)', true);
    const gate = new SkillExecutionGate();
    const first = gate.decide(skill, { tool: 'Bash(python:run)', kind: 'script' });
    expect(first.allowed).toBe(true);
    expect(first.requiresConfirmation).toBe(true);
    gate.markExecuted();
    const second = gate.decide(skill, { tool: 'Bash(python:run)', kind: 'script' });
    expect(second.requiresConfirmation).toBe(false);
  });

  it('SKILL-7: deploy/commit always require confirmation', () => {
    const skill = makeSkill('Bash(git:*)', true);
    const gate = new SkillExecutionGate();
    expect(gate.decide(skill, { tool: 'Bash(git:commit)', kind: 'commit' }).requiresConfirmation).toBe(true);
    expect(gate.decide(skill, { tool: 'Bash(git:push)', kind: 'deploy' }).requiresConfirmation).toBe(true);
  });

  it('denies network egress to a provider API host (anti-exfiltration)', () => {
    const policy: SandboxPolicy = {
      network: 'allowlist',
      egressAllowlist: ['api.openai.com', 'example.com'],
      dropCapabilities: ['ALL'],
      noHostFs: true,
      readOnlyRoot: true,
    };
    const skill = makeSkill('WebFetch', true);
    const gate = new SkillExecutionGate(policy);
    expect(gate.decide(skill, { tool: 'WebFetch', kind: 'network', target: 'https://api.openai.com/v1' }).allowed).toBe(
      false,
    );
    // A non-provider allowlisted host is permitted but still HITL-confirmed.
    const ok = gate.decide(skill, { tool: 'WebFetch', kind: 'network', target: 'https://example.com/data' });
    expect(ok.allowed).toBe(true);
    expect(ok.requiresConfirmation).toBe(true);
  });
});
