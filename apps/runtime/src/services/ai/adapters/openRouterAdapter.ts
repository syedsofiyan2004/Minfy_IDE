import { credentialStore } from '../../credentialStore.js';
import { OpenAICompatibleAdapter } from './openAICompatibleAdapter.js';
import { AIExecutionLocation, AIBillingType } from '@minfy/shared';

export function classifyOpenRouterModel(modelId: string, rawModel?: any): {
  executionLocation: AIExecutionLocation;
  billingType?: AIBillingType;
  costDescription: string;
} {
  const lower = modelId.toLowerCase();
  const isFreePricing =
    rawModel?.pricing &&
    rawModel.pricing.prompt === '0' &&
    rawModel.pricing.completion === '0';

  if (lower === 'openrouter/free' || isFreePricing || lower.includes(':free')) {
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

export function getOpenRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Title': 'Minfy IDE',
  };

  if (process.env.MINFY_APP_URL && process.env.MINFY_APP_URL.trim()) {
    headers['HTTP-Referer'] = process.env.MINFY_APP_URL.trim();
  }

  return headers;
}

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  constructor() {
    super({
      id: 'openrouter',
      name: 'OpenRouter',
      type: 'router',
      source: 'built-in',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      requiresAuth: true,
      getApiKey: () => credentialStore.getCredential('openrouter'),
      defaultExecutionLocation: 'cloud',
      defaultBillingType: 'unknown',
      customHeaders: getOpenRouterHeaders(),
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
