import { RouterModel } from '../router/types';

// Model lineage ("family") detection for council diversity. Two models from the
// same base family (e.g. two Llama derivatives) are NOT diverse even across
// providers — heterogeneity means different lineages, so the council doesn't
// become an echo chamber. Heuristic on the model id, falling back to provider.

const FAMILY_PATTERNS: [RegExp, string][] = [
  [/llama/i, 'llama'],
  [/gemini|gemma/i, 'gemini'],
  [/deepseek/i, 'deepseek'],
  [/mistral|mixtral|codestral|ministral/i, 'mistral'],
  [/qwen/i, 'qwen'],
  [/claude/i, 'anthropic'],
  [/gpt|davinci|\bo[134]\b|o1-|o3-|o4-/i, 'openai'],
  [/command|cohere/i, 'cohere'],
  [/phi-?\d/i, 'phi'],
  [/grok/i, 'grok'],
  [/nemotron/i, 'nemotron'],
];

export function familyOf(model: RouterModel): string {
  for (const [re, fam] of FAMILY_PATTERNS) {
    if (re.test(model.modelId)) {
      return fam;
    }
  }
  // Unknown lineage — fall back to the provider so distinct providers still
  // count as distinct families rather than collapsing into one "unknown".
  return model.providerId;
}
