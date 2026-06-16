import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { BestOfN, BestOfNConfig, BestOfNResult } from './BestOfN';
import { DEFAULT_WEIGHTS, Selector } from './Selector';
import { SampleSource } from './types';

// vscode glue for the Best-of-N engine. The sampling/stopping/selection pipeline
// is complete and unit-tested; the SAMPLER it draws from is an LLM author, which
// lands with codegen (same flagged deviation as the agent/council engines). Until
// then `run` is callable over injected sources and the command reports readiness.

export class BestOfNService {
  private readonly engine: BestOfN;

  constructor(
    private readonly logger: Logger,
    config: BestOfNConfig = {},
  ) {
    this.engine = new BestOfN(new Selector(DEFAULT_WEIGHTS), { maxSamples: 8, ...config });
  }

  /** Run Best-of-N over candidate sample sources (host wires real LLM draws). */
  async run(sources: SampleSource[]): Promise<BestOfNResult> {
    const result = await this.engine.run(sources);
    this.logger.info('bestofn_run', {
      opened: result.opened,
      stoppedBy: result.stoppedBy,
      winner: result.winner?.id ?? 'none',
      selectorMiss: result.selection.selectorMiss,
    });
    return result;
  }

  /** `conclave.bestOfN` — report the selector pipeline + readiness. */
  async statusCommand(): Promise<void> {
    void vscode.window.showInformationMessage(
      'conclave: Best-of-N selector ready — CodeT dual-execution consensus + type/critic/coverage, ' +
        'Pandora stopping (K≤8), CODING-stop on first ladder pass. Candidate authoring arrives with codegen.',
    );
  }
}
