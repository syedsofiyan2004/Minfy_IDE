export type AIProviderType = 'local' | 'api' | 'subscription' | 'enterprise' | 'router';

export type AIProviderStatus = 'available' | 'unavailable' | 'degraded' | 'checking';

export type AIExecutionLocation = 'local' | 'cloud' | 'hybrid' | 'unknown';

export type AIBillingType = 'local' | 'free' | 'subscription' | 'metered' | 'unknown';

export interface AIProvider {
  id: string;
  name: string;
  type: AIProviderType;
  status: AIProviderStatus;
  statusReason?: string;
  endpoint?: string;
  modelsCount?: number;
  requiresAuth?: boolean;
  connected?: boolean;
  credentialBackend?: string;
}

export interface AIModel {
  id: string;
  providerId: string;
  displayName: string;
  executionLocation: AIExecutionLocation;
  billingType?: AIBillingType;
  sizeBytes?: number;
  contextWindow?: number;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  family?: string;
  parameterSize?: string;
}

export interface AIGenerateRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  system?: string;
  stream?: boolean;
}

export type AIStreamEventType = 'started' | 'text-delta' | 'completed' | 'error' | 'usage';

export interface AIStreamEvent {
  type: AIStreamEventType;
  textDelta?: string;
  error?: string;
  usage?: AIUsage;
}

export interface AIUsage {
  providerId: string;
  modelId: string;
  resolvedModelId?: string;
  executionLocation: AIExecutionLocation;
  billingType?: AIBillingType;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  status: 'completed' | 'cancelled' | 'error';
  costDescription?: string;
}

export interface AIProvidersResponse {
  providers: AIProvider[];
  credentialBackend?: string;
  credentialBackendName?: string;
}

export interface AIModelsResponse {
  providerId: string;
  models: AIModel[];
}

export interface ConnectProviderRequest {
  apiKey: string;
}

export interface ConnectProviderResponse {
  connected: boolean;
  modelsCount?: number;
  credentialBackend?: string;
}
