import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { ProviderRegistry } from '../providers/registry';
import { Provider, ModelInfo } from '../providers/types';
import { KeyStore } from '../keys/KeyStore';
import { PricedCost } from '../cost/PricedCost';
import { CostPolicy } from '../cost/CostPolicy';
import { BudgetManager } from '../cost/BudgetManager';
import { CascadeRouter, RouteResult } from './CascadeRouter';
import { DifficultyEstimator } from './DifficultyEstimator';
import { DifficultySignals, Role, RouterModel } from './types';

// vscode glue for the cascade router. Builds the candidate POOL from keyed,
// available providers, scores each with pricedCost (real $ + shadow-priced
// scarcity), and gates eligibility through the live CostPolicy + spend cap.
// The pure routing logic lives in CascadeRouter; this only assembles its deps.

// Nominal stage token sizes so pricedCost yields a comparable scalar across
// candidates. Not a budget estimate — just a fixed yardstick for ranking.
const STAGE_TOKENS_IN = 4000;
const STAGE_TOKENS_OUT = 1500;

function toRouterModel(p: Provider, m: ModelInfo): RouterModel {
  return {
    providerId: p.id,
    modelId: m.id,
    kind: p.kind,
    capabilities: m.capabilities ?? [],
    inputPricePerMTok: m.inputPricePerMTok ?? 0,
    outputPricePerMTok: m.outputPricePerMTok ?? 0,
  };
}

export class RouterService {
  private readonly estimator: DifficultyEstimator;

  constructor(
    private readonly logger: Logger,
    private readonly registry: ProviderRegistry,
    private readonly keys: KeyStore,
    private readonly pricedCost: PricedCost,
    private readonly policy: CostPolicy,
    private readonly budget?: BudgetManager,
  ) {
    this.estimator = new DifficultyEstimator({
      log: (event, data) => this.logger.info(event, data),
    });
  }

  /** Difficulty estimator (shared so callers can fold drift back in). */
  get difficulty(): DifficultyEstimator {
    return this.estimator;
  }

  /** Models from providers that currently have a key, flattened for the router. */
  private async keyedPool(): Promise<RouterModel[]> {
    const out: RouterModel[] = [];
    for (const p of this.registry.list()) {
      if (!(await this.keys.hasKey(p.id))) {
        continue;
      }
      for (const m of p.defaultModels) {
        out.push(toRouterModel(p, m));
      }
    }
    return out;
  }

  private async router(): Promise<CascadeRouter> {
    const pool = await this.keyedPool();
    return new CascadeRouter({
      pool: () => pool,
      priceOf: (m) =>
        this.pricedCost.price({
          providerId: m.providerId,
          modelId: m.modelId,
          tokensIn: STAGE_TOKENS_IN,
          tokensOut: STAGE_TOKENS_OUT,
        }).total,
      policy: this.policy,
      policyCtx: () => ({ capReached: this.budget?.capReached() ?? false }),
      estimator: this.estimator,
      logger: { info: (e, d) => this.logger.info(e, d ?? {}) },
    });
  }

  /** Route a stage to a concrete model under the live cost policy. */
  async route(role: Role, goal: string, signals?: DifficultySignals): Promise<RouteResult> {
    return (await this.router()).route(role, goal, signals);
  }

  /** `conclave.estimateDifficulty` — show the difficulty + routed implement model. */
  async estimateDifficultyCommand(): Promise<void> {
    const goal = await vscode.window.showInputBox({
      title: 'conclave — estimate difficulty',
      prompt: 'Describe the change; conclave estimates difficulty and picks a model tier.',
      ignoreFocusOut: true,
    });
    if (!goal) {
      return;
    }
    const result = await this.route('implement', goal);
    const est = result.estimate;
    const pick = result.chosen
      ? `${result.chosen.model.providerId}/${result.chosen.model.modelId} (${result.chosen.tier})`
      : 'no keyed model available';
    const flag = result.flags.length ? ` — ${result.flags[0]}` : '';
    void vscode.window.showInformationMessage(
      `conclave: ${est.taskType}, difficulty ${est.d.toFixed(2)} (${est.level}) → start ${result.startTier}, pick ${pick}${flag}`,
    );
  }
}
