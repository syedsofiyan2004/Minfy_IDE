import {
  AIProviderType,
  AIProviderStatus,
  AIModel,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
  ProviderManifestSource,
} from '@minfy/shared';

export interface AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: AIProviderType;
  readonly source?: ProviderManifestSource;
  readonly protocol?: string;

  getStatus(): Promise<{ status: AIProviderStatus; reason?: string; modelsCount?: number }>;

  listModels(): Promise<AIModel[]>;

  generate(
    request: AIGenerateRequest,
    onStream: (event: AIStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<AIUsage>;

  validateCredential?(credential: string): Promise<{ valid: boolean; reason?: string }>;

  getConnectionState?(): Promise<{
    connected: boolean;
    authSource?: string;
    reason?: string;
    region?: string;
    profile?: string;
    planType?: string;
    status?: AIProviderStatus;
  }>;
}
