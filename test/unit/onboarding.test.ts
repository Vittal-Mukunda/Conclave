import { describe, it, expect } from 'vitest';
import {
  evaluateOnboarding,
  shouldLaunchWizard,
  WorkspaceFacts,
} from '../../src/onboarding/OnboardingService';

function facts(over: Partial<WorkspaceFacts> = {}): WorkspaceFacts {
  return { hasAnyKey: true, folderOpen: true, isGitRepo: true, firstRun: false, ...over };
}

describe('evaluateOnboarding', () => {
  it('ready when a key + folder are present (git optional)', () => {
    const s = evaluateOnboarding(facts({ isGitRepo: false }));
    expect(s.ready).toBe(true);
    expect(s.blocker).toBeUndefined();
  });

  it('SETUP-1: no key blocks running and is the next step', () => {
    const s = evaluateOnboarding(facts({ hasAnyKey: false }));
    expect(s.ready).toBe(false);
    expect(s.nextStep?.id).toBe('keys');
    expect(s.blocker?.code).toBe('SETUP-1');
  });

  it('SETUP-11: no folder blocks running', () => {
    const s = evaluateOnboarding(facts({ folderOpen: false }));
    expect(s.ready).toBe(false);
    const keys = s.steps.find((x) => x.id === 'keys')!;
    expect(keys.done).toBe(true);
    expect(s.nextStep?.id).toBe('folder');
    expect(s.blocker?.code).toBe('SETUP-11');
  });

  it('keys takes precedence over folder when both missing', () => {
    const s = evaluateOnboarding(facts({ hasAnyKey: false, folderOpen: false }));
    expect(s.nextStep?.id).toBe('keys');
    expect(s.blocker?.code).toBe('SETUP-1');
  });

  it('SETUP-12: git step is optional — not ready-blocking but surfaced when folder open', () => {
    const s = evaluateOnboarding(facts({ isGitRepo: false }));
    const git = s.steps.find((x) => x.id === 'git')!;
    expect(git.required).toBe(false);
    expect(git.done).toBe(false);
    expect(s.ready).toBe(true); // optional, does not block
    expect(s.nextStep?.id).toBe('git'); // still offered
  });

  it('git step hidden (treated done) until a folder is open', () => {
    const s = evaluateOnboarding(facts({ folderOpen: false, isGitRepo: false }));
    const git = s.steps.find((x) => x.id === 'git')!;
    expect(git.done).toBe(true); // moot without a folder
  });

  it('blocker carries the step action plus a resume action', () => {
    const s = evaluateOnboarding(facts({ hasAnyKey: false }));
    const cmds = s.blocker!.recoveryActions.map((a) => a.command);
    expect(cmds).toContain('conclave.manageKeys');
    expect(cmds).toContain('conclave.startOnboarding');
  });
});

describe('shouldLaunchWizard', () => {
  it('launches on first run even when ready', () => {
    expect(shouldLaunchWizard(evaluateOnboarding(facts({ firstRun: true })))).toBe(true);
  });

  it('launches when not ready', () => {
    expect(shouldLaunchWizard(evaluateOnboarding(facts({ hasAnyKey: false })))).toBe(true);
  });

  it('does not launch when ready and already onboarded', () => {
    expect(shouldLaunchWizard(evaluateOnboarding(facts()))).toBe(false);
  });
});
