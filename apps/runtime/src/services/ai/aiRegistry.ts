import {
  AIProvider,
  AIModel,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
} from '@minfy/shared';
import { AIProviderAdapter } from './types.js';
import { OllamaAdapter } from './adapters/ollamaAdapter.js';

export class AIProviderRegistry {
  private adapters: Map<string, AIProviderAdapter> = new Map();
  private activeGenerations: Map<string, AbortController> = new Map();
  private usageHistory: AIUsage[] = [];

  constructor() {
    // Register default Milestone 3 local adapter
    this.registerAdapter(new OllamaAdapter());
  }

  public registerAdapter(adapter: AIProviderAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  public getAdapter(id: string): AIProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  public async listProviders(): Promise<AIProvider[]> {
    const providers: AIProvider[] = [];

    for (const adapter of this.adapters.values()) {
      try {
        const { status, reason, modelsCount } = await adapter.getStatus();
        providers.push({
          id: adapter.id,
          name: adapter.name,
          type: adapter.type,
          status,
          statusReason: reason,
          modelsCount,
        });
      } catch (err: any) {
        providers.push({
          id: adapter.id,
          name: adapter.name,
          type: adapter.type,
          status: 'unavailable',
          statusReason: err.message || 'Provider check failed',
          modelsCount: 0,
        });
      }
    }

    return providers;
  }

  public async listModels(providerId: string): Promise<AIModel[]> {
    const adapter = this.adapters.get(providerId);
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
    const adapter = this.adapters.get(request.providerId);
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
    this.activeGenerations.set(generationId, abortController);

    try {
      const usage = await adapter.generate(request, onStream, abortController.signal);
      this.recordUsage(usage);
      return usage;
    } finally {
      this.activeGenerations.delete(generationId);
    }
  }

  public cancel(generationId: string): boolean {
    const controller = this.activeGenerations.get(generationId);
    if (controller) {
      controller.abort();
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
