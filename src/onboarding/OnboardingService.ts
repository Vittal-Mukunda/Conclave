import { RecoveryAction, ConclaveError } from '../errors/ErrorReport';

// First-run onboarding logic, kept vscode-free so it is unit-testable. Given a
// snapshot of the environment it computes the ordered setup steps, whether
// conclave is READY to run, and a surfaceable blocker for the first unmet
// REQUIRED step. The host gathers the facts and performs the step actions.
//
// Catalog: UX-5 (first run -> wizard), SETUP-1 (no keys -> guide, can't run),
// SETUP-11 (no folder -> prompt, disable run), SETUP-12 (not a git repo ->
// offer init or read-only with warning).

export interface WorkspaceFacts {
  /** At least one provider has a stored key. */
  hasAnyKey: boolean;
  /** A workspace folder is open. */
  folderOpen: boolean;
  /** The open folder is a git repository. */
  isGitRepo: boolean;
  /** The wizard has never been completed for this user. */
  firstRun: boolean;
}

export type OnboardingStepId = 'keys' | 'folder' | 'git';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  detail: string;
  done: boolean;
  /** A required step blocks running until done; an optional step only degrades. */
  required: boolean;
  code: string;
  action: RecoveryAction;
}

export interface OnboardingStatus {
  /** All REQUIRED steps satisfied — conclave may run. */
  ready: boolean;
  firstRun: boolean;
  steps: OnboardingStep[];
  /** First incomplete step (required ones surface first by order). */
  nextStep?: OnboardingStep;
  /** Surfaceable report for the first unmet required step, when not ready. */
  blocker?: ConclaveError;
}

const RESUME_ACTION: RecoveryAction = {
  label: 'Open setup',
  kind: 'configure',
  command: 'conclave.startOnboarding',
};

export function evaluateOnboarding(facts: WorkspaceFacts): OnboardingStatus {
  const steps: OnboardingStep[] = [
    {
      id: 'keys',
      title: 'Add a provider key',
      detail: 'conclave needs at least one working free or paid LLM key before it can run.',
      done: facts.hasAnyKey,
      required: true,
      code: 'SETUP-1',
      action: { label: 'Add key', kind: 'add', command: 'conclave.manageKeys' },
    },
    {
      id: 'folder',
      title: 'Open a project folder',
      detail: 'Open the folder you want conclave to work in.',
      done: facts.folderOpen,
      required: true,
      code: 'SETUP-11',
      action: { label: 'Open folder', kind: 'configure', command: 'workbench.action.files.openFolder' },
    },
    {
      id: 'git',
      title: 'Initialize git (recommended)',
      // Only meaningful once a folder is open; treated as satisfied otherwise so
      // it never blocks or distracts before the folder step is done.
      detail:
        'git lets conclave checkpoint your work before it edits. Without it conclave still runs, but read-only-safe with a warning.',
      done: facts.isGitRepo || !facts.folderOpen,
      required: false,
      code: 'SETUP-12',
      action: { label: 'Initialize git', kind: 'start', command: 'conclave.initGit' },
    },
  ];

  const ready = steps.filter((s) => s.required).every((s) => s.done);
  const nextStep = steps.find((s) => !s.done);
  const unmetRequired = steps.find((s) => s.required && !s.done);
  const blocker = unmetRequired ? blockerFor(unmetRequired) : undefined;

  return { ready, firstRun: facts.firstRun, steps, nextStep, blocker };
}

/** Whether the wizard should auto-open: first run, or still not runnable. */
export function shouldLaunchWizard(status: OnboardingStatus): boolean {
  return status.firstRun || !status.ready;
}

function blockerFor(step: OnboardingStep): ConclaveError {
  return new ConclaveError({
    category: 'setup',
    severity: 'warning',
    code: step.code,
    title: step.title,
    detail: step.detail,
    canRetry: true,
    recoveryActions: [step.action, RESUME_ACTION],
  });
}
