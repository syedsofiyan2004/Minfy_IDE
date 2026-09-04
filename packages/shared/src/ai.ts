export type AIProviderType = 'local' | 'api' | 'subscription' | 'enterprise' | 'router';

export type AIProviderStatus = 'available' | 'unavailable' | 'degraded' | 'checking';

export type AIExecutionLocation = 'local' | 'cloud' | 'hybrid' | 'unknown';

export type AIBillingType = 'local' | 'free' | 'subscription' | 'metered' | 'unknown';

export type ProviderManifestProtocol = 'openai-compatible';
export type ProviderManifestSource = 'built-in' | 'custom';
export type ProviderAuthType = 'none' | 'bearer';

export interface ProviderAuth {
  type: ProviderAuthType;
  required?: boolean;
}

export interface ProviderEndpoints {
  models?: string;
  chatCompletions?: string;
}

export interface ProviderDefaults {
  executionLocation?: AIExecutionLocation;
  billingType?: AIBillingType;
}

export interface ProviderManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  protocol: ProviderManifestProtocol;
  providerType: AIProviderType;
  baseUrl: string;
  auth: ProviderAuth;
  endpoints?: ProviderEndpoints;
  defaults?: ProviderDefaults;
  customHeaders?: Record<string, string>;
  enabled?: boolean;
  source?: ProviderManifestSource;
}

export interface ProviderManifestsResponse {
  manifests: ProviderManifest[];
}

export interface BedrockConfig {
  region?: string;
  profile?: string;
  configured?: boolean;
}

export interface BedrockTestResult {
  connected: boolean;
  identity?: string;
  modelsCount?: number;
  reason?: string;
}

export interface CodexAccountInfo {
  connected: boolean;
  authMode?: 'chatgpt' | 'apiKey';
  planType?: string;
  error?: string;
}

export interface CodexLoginStartResponse {
  loginId: string;
  authUrl: string;
  status: 'pending';
}

export interface CodexLoginStatusResponse {
  loginId: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

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
  authSource?: string;
  region?: string;
  profile?: string;
  planType?: string;
  source?: ProviderManifestSource;
  protocol?: string;
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
  isCrossRegion?: boolean;
  inferenceProfileType?: 'SYSTEM_DEFINED' | 'APPLICATION';
  providerDisplayName?: string;
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
