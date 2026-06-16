import { AdapterKind, ModelInfo, Provider } from './types';
import { ChatAdapter } from './adapters/ChatAdapter';
import { OpenAICompatibleAdapter } from './adapters/OpenAICompatibleAdapter';
import { AnthropicAdapter } from './adapters/AnthropicAdapter';

// Built-in provider catalog. Free tiers + paid frontier, behind one uniform
// interface (BYOK for both). Model lists are representative defaults, not
// exhaustive — they are data and can be extended without code changes.
export const BUILTIN_PROVIDERS: Provider[] = [
  // ---- FREE tiers ----
  {
    id: 'groq',
    label: 'Groq',
    kind: 'free',
    baseURL: 'https://api.groq.com/openai/v1',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://console.groq.com/keys',
    defaultModels: [
      { id: 'llama-3.3-70b-versatile', contextWindow: 131072, capabilities: ['code', 'reasoning'] },
      { id: 'llama-3.1-8b-instant', contextWindow: 131072, capabilities: ['code'] },
    ],
  },
  {
    id: 'google',
    label: 'Google AI Studio (Gemini)',
    kind: 'free',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModels: [
      { id: 'gemini-2.0-flash', contextWindow: 1048576, capabilities: ['code', 'reasoning', 'vision'] },
      { id: 'gemini-2.0-flash-lite', contextWindow: 1048576, capabilities: ['code'] },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'free',
    baseURL: 'https://openrouter.ai/api/v1',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://openrouter.ai/keys',
    defaultModels: [
      { id: 'deepseek/deepseek-r1:free', contextWindow: 65536, capabilities: ['reasoning', 'code'] },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', contextWindow: 131072, capabilities: ['code'] },
    ],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'free',
    baseURL: 'https://api.cerebras.ai/v1',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://cloud.cerebras.ai',
    defaultModels: [{ id: 'llama-3.3-70b', contextWindow: 65536, capabilities: ['code', 'reasoning'] }],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'free',
    baseURL: 'https://api.mistral.ai/v1',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://console.mistral.ai/api-keys',
    defaultModels: [
      { id: 'mistral-large-latest', contextWindow: 131072, capabilities: ['code', 'reasoning'] },
      { id: 'codestral-latest', contextWindow: 262144, capabilities: ['code'] },
    ],
  },
  {
    id: 'github',
    label: 'GitHub Models',
    kind: 'free',
    baseURL: 'https://models.inference.ai.azure.com',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://github.com/settings/tokens',
    defaultModels: [{ id: 'gpt-4o-mini', contextWindow: 128000, capabilities: ['code'] }],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'free',
    baseURL: 'https://api.deepseek.com/v1',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    defaultModels: [
      { id: 'deepseek-chat', contextWindow: 65536, capabilities: ['code'] },
      { id: 'deepseek-reasoner', contextWindow: 65536, capabilities: ['reasoning', 'code'] },
    ],
  },

  // ---- PAID frontier (BYOK) ----
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'paid',
    baseURL: 'https://api.openai.com/v1',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModels: [
      { id: 'gpt-4.1', contextWindow: 1047576, inputPricePerMTok: 2, outputPricePerMTok: 8, capabilities: ['code', 'reasoning', 'tools'] },
      { id: 'gpt-4.1-mini', contextWindow: 1047576, inputPricePerMTok: 0.4, outputPricePerMTok: 1.6, capabilities: ['code'] },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'paid',
    baseURL: 'https://api.anthropic.com',
    adapter: 'anthropic',
    authStyle: 'x-api-key',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModels: [
      { id: 'claude-3-5-sonnet-latest', contextWindow: 200000, inputPricePerMTok: 3, outputPricePerMTok: 15, capabilities: ['code', 'reasoning', 'tools'] },
      { id: 'claude-3-5-haiku-latest', contextWindow: 200000, inputPricePerMTok: 0.8, outputPricePerMTok: 4, capabilities: ['code'] },
    ],
  },
  {
    id: 'google-paid',
    label: 'Google (paid tier)',
    kind: 'paid',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    adapter: 'openai',
    authStyle: 'bearer',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModels: [
      { id: 'gemini-2.5-pro', contextWindow: 1048576, inputPricePerMTok: 1.25, outputPricePerMTok: 10, capabilities: ['code', 'reasoning', 'vision'] },
    ],
  },
];

const ADAPTERS: Record<AdapterKind, ChatAdapter> = {
  openai: new OpenAICompatibleAdapter(),
  anthropic: new AnthropicAdapter(),
};

export function getAdapter(kind: AdapterKind): ChatAdapter {
  return ADAPTERS[kind];
}

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  constructor(seed: Provider[] = BUILTIN_PROVIDERS) {
    for (const p of seed) {
      this.providers.set(p.id, p);
    }
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  add(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  list(kind?: 'free' | 'paid'): Provider[] {
    const all = [...this.providers.values()];
    return kind ? all.filter((p) => p.kind === kind) : all;
  }

  adapterFor(provider: Provider): ChatAdapter {
    return getAdapter(provider.adapter);
  }

  /** Pick a same-provider replacement model when one is removed (PROV-8). */
  equivalentModel(providerId: string, missingModelId: string): ModelInfo | undefined {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return undefined;
    }
    return provider.defaultModels.find((m) => m.id !== missingModelId);
  }
}
