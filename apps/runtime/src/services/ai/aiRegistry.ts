import {
  AIProvider,
  AIModel,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
  ProviderManifestSource,
} from '@minfy/shared';
import { AIProviderAdapter } from './types.js';
import { OllamaAdapter } from './adapters/ollamaAdapter.js';
import { OpenRouterAdapter } from './adapters/openRouterAdapter.js';
import { bedrockAdapter } from './bedrock/bedrockAdapter.js';
import { codexAdapter } from './codex/codexAdapter.js';
import { ProviderFactory } from './providerFactory.js';
import { providerManifestService, RESERVED_PROVIDER_IDS } from './providerManifestService.js';
import { credentialStore } from '../credentialStore.js';

interface ActiveGen {
  controller: AbortController;
  providerId: string;
}

export class AIProviderRegistry {
  private adapters: Map<string, AIProviderAdapter> = new Map();
  private activeGenerations: Map<string, ActiveGen> = new Map();
  private usageHistory: AIUsage[] = [];
  private builtInIds: Set<string> = new Set(RESERVED_PROVIDER_IDS);

  constructor() {
    // Register Milestone 3 local adapter
    this.registerAdapter(new OllamaAdapter());
    // Register Milestone 4 remote OpenAI-compatible router
    this.registerAdapter(new OpenRouterAdapter());
    // Register Milestone 6 enterprise AWS Bedrock adapter
    this.registerAdapter(bedrockAdapter);
    // Register Milestone 7 OpenAI Codex App Server adapter
    this.registerAdapter(codexAdapter);
  }

  public isBuiltIn(id: string): boolean {
    return this.builtInIds.has(id.toLowerCase());
  }

  public registerAdapter(adapter: AIProviderAdapter): void {
    this.adapters.set(adapter.id.toLowerCase(), adapter);
  }

  public unregisterAdapter(id: string): boolean {
    const cleanId = id.toLowerCase();
    if (this.isBuiltIn(cleanId)) {
      throw new Error(`Built-in provider "${cleanId}" cannot be removed.`);
    }

    if (this.hasActiveGeneration(cleanId)) {
      throw new Error(`Cannot remove provider "${cleanId}" while an active generation is in progress. Stop the generation first.`);
    }

    return this.adapters.delete(cleanId);
  }

  public hasActiveGeneration(providerId: string): boolean {
    const cleanId = providerId.toLowerCase();
    for (const gen of this.activeGenerations.values()) {
      if (gen.providerId.toLowerCase() === cleanId) {
        return true;
      }
    }
    return false;
  }

  public async loadCustomManifests(): Promise<void> {
    try {
      const manifests = providerManifestService.listManifests();
      const enabledManifests = manifests.filter((m) => m.enabled !== false);
      const customIds = enabledManifests.map((m) => m.id);
      if (customIds.length > 0) {
        await credentialStore.loadInitialCredentials(customIds).catch(() => {});
      }
      for (const manifest of enabledManifests) {
        if (this.isBuiltIn(manifest.id)) {
          console.warn(`[AIProviderRegistry] Skipping custom manifest for reserved ID "${manifest.id}"`);
          continue;
        }

        try {
          const adapter = ProviderFactory.createProviderFromManifest(manifest);
          this.registerAdapter(adapter);
        } catch (err: any) {
          console.warn(`[AIProviderRegistry] Failed to initialize adapter from manifest "${manifest.id}": ${err.message}`);
        }
      }
    } catch (err: any) {
      console.warn(`[AIProviderRegistry] Failed to load custom manifests: ${err.message}`);
    }
  }

  public getAdapter(id: string): AIProviderAdapter | undefined {
    return this.adapters.get(id.toLowerCase());
  }

  public async listProviders(): Promise<AIProvider[]> {
    const providers: AIProvider[] = [];

    for (const adapter of this.adapters.values()) {
      const isBuiltIn = this.isBuiltIn(adapter.id);
      const source: ProviderManifestSource = adapter.source || (isBuiltIn ? 'built-in' : 'custom');
      const protocol = adapter.protocol || 'openai-compatible';

      try {
        const statusRes = await adapter.getStatus();
        let status = statusRes.status;
        const reason = statusRes.reason;
        const modelsCount = statusRes.modelsCount;
        const requiresAuth = (adapter as any).requiresAuth ?? false;
        let connected = status === 'available';
        let authSource: string | undefined = undefined;
        let region: string | undefined = undefined;
        let profile: string | undefined = undefined;
        let planType: string | undefined = undefined;
        let finalReason = reason;

        if (adapter.getConnectionState) {
          const conn = await adapter.getConnectionState();
          connected = conn.connected;
          authSource = conn.authSource;
          region = conn.region;
          profile = conn.profile;
          planType = conn.planType;
          if (conn.status) status = conn.status;
          if (conn.reason) finalReason = conn.reason;
        } else if (requiresAuth) {
          if (credentialStore.hasCredential(adapter.id)) {
            connected = true;
          } else {
            const cred = await credentialStore.get(adapter.id);
            connected = Boolean(cred);
          }
        }

        providers.push({
          id: adapter.id,
          name: adapter.name,
          type: adapter.type,
          status,
          statusReason: finalReason,
          modelsCount,
          requiresAuth,
          connected,
          authSource,
          region,
          profile,
          planType,
          source,
          protocol,
        });
      } catch (err: any) {
        providers.push({
          id: adapter.id,
          name: adapter.name,
          type: adapter.type,
          status: 'unavailable',
          statusReason: err.message || 'Provider check failed',
          modelsCount: 0,
          connected: false,
          source,
          protocol,
        });
      }
    }

    // Sort: built-in providers first, then custom providers alphabetically by name
    return providers.sort((a, b) => {
      if (a.source === 'built-in' && b.source !== 'built-in') return -1;
      if (a.source !== 'built-in' && b.source === 'built-in') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  public async listModels(providerId: string): Promise<AIModel[]> {
    const adapter = this.adapters.get(providerId.toLowerCase());
    if (!adapter) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    return adapter.listModels();
  }

  public async generate(
    generationId: string,
    request: AIGenerateRequest,
    onStream: (event: AIStreamEvent) => void
  ): Promise<AIUsage> {
    const adapter = this.adapters.get(request.providerId.toLowerCase());
    if (!adapter) {
      const errorMsg = `AI Provider not found: ${request.providerId}`;
      const failedUsage: AIUsage = {
        providerId: request.providerId,
        modelId: request.modelId,
        executionLocation: 'unknown',
        billingType: 'unknown',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        status: 'error',
        costDescription: 'Unknown',
      };
      onStream({ type: 'error', error: errorMsg, usage: failedUsage });
      return failedUsage;
    }

    const abortController = new AbortController();
    this.activeGenerations.set(generationId, {
      controller: abortController,
      providerId: adapter.id,
    });

    try {
      const usage = await adapter.generate(request, onStream, abortController.signal);
      this.recordUsage(usage);
      return usage;
    } finally {
      this.activeGenerations.delete(generationId);
    }
  }

  public cancel(generationId: string): boolean {
    const gen = this.activeGenerations.get(generationId);
    if (gen) {
      gen.controller.abort();
      this.activeGenerations.delete(generationId);
      return true;
    }
    return false;
  }

  private recordUsage(usage: AIUsage) {
    this.usageHistory.unshift(usage);
    if (this.usageHistory.length > 50) {
      this.usageHistory.pop();
    }
  }

  public getUsageHistory(): AIUsage[] {
    return [...this.usageHistory];
  }
}

export const aiProviderRegistry = new AIProviderRegistry();
