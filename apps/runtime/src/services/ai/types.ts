import {
  AIProviderType,
  AIProviderStatus,
  AIModel,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
} from '@minfy/shared';

export interface AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: AIProviderType;

  getStatus(): Promise<{ status: AIProviderStatus; reason?: string; modelsCount?: number }>;

  listModels(): Promise<AIModel[]>;

  generate(
    request: AIGenerateRequest,
    onStream: (event: AIStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<AIUsage>;
}
