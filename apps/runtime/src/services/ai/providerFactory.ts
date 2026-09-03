import { ProviderManifest } from '@minfy/shared';
import { OpenAICompatibleAdapter } from './adapters/openAICompatibleAdapter.js';
import { AIProviderAdapter } from './types.js';
import { credentialStore } from '../credentialStore.js';

export class ProviderFactory {
  /**
   * Instantiate an AIProviderAdapter from a validated ProviderManifest.
   */
  public static createProviderFromManifest(manifest: ProviderManifest): AIProviderAdapter {
    if (manifest.protocol !== 'openai-compatible') {
      throw new Error(`Unsupported manifest protocol: ${manifest.protocol}`);
    }

    const requiresAuth = manifest.auth?.type === 'bearer';

    return new OpenAICompatibleAdapter({
      id: manifest.id,
      name: manifest.name,
      type: manifest.providerType,
      source: manifest.source || 'custom',
      baseUrl: manifest.baseUrl,
      requiresAuth,
      getApiKey: requiresAuth
        ? async () => (await credentialStore.get(manifest.id)) ?? undefined
        : undefined,
      endpoints: manifest.endpoints,
      defaultExecutionLocation: manifest.defaults?.executionLocation || 'unknown',
      defaultBillingType: manifest.defaults?.billingType || 'unknown',
      customHeaders: manifest.customHeaders,
    });
  }
}
