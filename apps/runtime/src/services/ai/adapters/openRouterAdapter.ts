import { credentialStore } from '../../credentialStore.js';
import { OpenAICompatibleAdapter } from './openAICompatibleAdapter.js';
import { AIExecutionLocation, AIBillingType } from '@minfy/shared';

export function classifyOpenRouterModel(modelId: string, rawModel?: any): {
  executionLocation: AIExecutionLocation;
  billingType?: AIBillingType;
  costDescription: string;
} {
  const lower = modelId.toLowerCase();
  const isFreePricing = rawModel?.pricing?.prompt === '0' && rawModel?.pricing?.completion === '0';

  if (lower === 'openrouter/free' || lower.includes(':free') || isFreePricing) {
    return {
      executionLocation: 'cloud',
      billingType: 'free',
      costDescription: 'OpenRouter Free • Remote inference • Free token pricing',
    };
  }

  return {
    executionLocation: 'cloud',
    billingType: 'unknown',
    costDescription: 'Remote inference via OpenRouter • Provider quota applies',
  };
}

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      id: 'openrouter',
      name: 'OpenRouter',
      type: 'router',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      requiresAuth: true,
      getApiKey: () => credentialStore.getCredential('openrouter'),
      defaultExecutionLocation: 'cloud',
      defaultBillingType: 'unknown',
      customHeaders: {
        'HTTP-Referer': 'https://minfy.tech',
        'X-Title': 'Minfy IDE',
      },
      extraModels: [
        {
          id: 'openrouter/free',
          providerId: 'openrouter',
          displayName: 'openrouter/free',
          executionLocation: 'cloud',
          billingType: 'free',
          supportsStreaming: true,
        },
      ],
      modelClassifier: classifyOpenRouterModel,
    });
  }
}
