import {
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import {
  ConverseStreamCommand,
  ConverseStreamCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  AIModel,
  AIProviderStatus,
  AIProviderType,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
  ProviderManifestSource,
} from '@minfy/shared';
import { AIProviderAdapter } from '../types.js';
import { bedrockConfigService } from './bedrockConfigService.js';
import { bedrockClientFactory } from './bedrockClientFactory.js';

// Known Converse-compatible model ID prefixes
const CONVERSE_SUPPORTED_FAMILIES = [
  'anthropic.claude',
  'amazon.nova',
  'amazon.titan-text',
  'meta.llama',
  'mistral.',
  'cohere.command',
  'ai21.jamba',
];

export function isKnownConverseSupported(modelId: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return CONVERSE_SUPPORTED_FAMILIES.some((prefix) => lower.includes(prefix));
}

export interface BedrockInferenceTarget {
  publicId: string;
  invocationTarget: string;
  type: 'foundation-model' | 'system-inference-profile' | 'application-inference-profile';
}

export interface BedrockConnectionSnapshot {
  connected: boolean;
  status: AIProviderStatus;
  reason?: string;
  authSource?: string;
  region?: string;
  profile?: string;
  modelsCount?: number;
  timestamp: number;
  key: string;
}

/**
 * Sanitizes any user-facing AWS error message to ensure zero AWS ARNs
 * and zero 12-digit AWS Account IDs leak to the browser or client responses.
 */
export function sanitizeAwsErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') return message;

  let sanitized = message;

  // 1. Redact AWS ARNs across all partitions (aws, aws-us-gov, aws-cn, aws-iso, etc.)
  const arnRegex = /arn:aws[a-z0-9-]*:[a-z0-9-]*:[a-z0-9-]*:[0-9]*:[^"'\s,;:)]+/gi;
  sanitized = sanitized.replace(arnRegex, '[AWS ARN redacted]');

  // 2. Redact 12-digit AWS Account IDs (isolated or within ARN/identity strings)
  const accountRegex = /\b\d{12}\b/g;
  sanitized = sanitized.replace(accountRegex, '[AWS account redacted]');

  return sanitized;
}

export class BedrockAdapter implements AIProviderAdapter {
  public readonly id = 'bedrock';
  public readonly name = 'AWS Bedrock';
  public readonly type: AIProviderType = 'enterprise';
  public readonly source: ProviderManifestSource = 'built-in';
  public readonly protocol = 'bedrock';

  // Unified connection & status snapshot cache
  private connectionSnapshot: BedrockConnectionSnapshot | null = null;
  // Cache discovery results for 60s
  private modelCache: { models: AIModel[]; timestamp: number; key: string } | null = null;
  // Private runtime-side target mapping: publicId -> BedrockInferenceTarget
  private inferenceTargets: Map<string, BedrockInferenceTarget> = new Map();
  // Session memory for targets that fail specifically because Converse is not supported
  private sessionIncompatibleTargets: Set<string> = new Set();

  constructor() {
    bedrockConfigService.onConfigChange(() => {
      this.invalidateCache();
    });
  }

  public invalidateCache(): void {
    this.connectionSnapshot = null;
    this.modelCache = null;
    this.inferenceTargets.clear();
  }

  private getConfigKey(): string {
    const cfg = bedrockConfigService.getConfig();
    return `${cfg.region || 'none'}:${cfg.profile || 'none'}`;
  }

  public normalizeError(err: any, context?: 'auth' | 'control-plane' | 'runtime'): string {
    if (!err) return 'Unknown AWS error';

    const code = err.name || err.code || err.__type || '';
    const message = err.message || '';

    let rawMessage: string;

    // Credential resolution failure
    if (
      code === 'CredentialsProviderError' ||
      message.includes('Could not load credentials from any providers') ||
      message.includes('CredentialsProviderError')
    ) {
      rawMessage = 'AWS credentials could not be resolved.';
    }
    // Expired session / token
    else if (
      code === 'ExpiredToken' ||
      code === 'ExpiredTokenException' ||
      message.includes('The security token included in the request is expired') ||
      message.includes('Token has expired')
    ) {
      rawMessage = 'Your AWS session has expired. Sign in again using your configured AWS profile.';
    }
    // Access Denied / IAM Permissions
    else if (code === 'AccessDeniedException' || code === 'UnauthorizedException' || message.includes('AccessDenied')) {
      if (context === 'runtime') {
        rawMessage = "You don't have permission to invoke this Bedrock model. Check your IAM policy for bedrock:InvokeModelWithResponseStream.";
      } else {
        rawMessage = 'AWS credentials are valid, but this identity does not have permission to use Amazon Bedrock.';
      }
    }
    // Throttling
    else if (code === 'ThrottlingException' || code === 'TooManyRequestsException' || message.includes('throttl')) {
      rawMessage = 'Amazon Bedrock is throttling requests. Try again shortly.';
    }
    // Resource / Model Not Found
    else if (code === 'ResourceNotFoundException' || message.includes('ResourceNotFound')) {
      rawMessage = 'The selected Bedrock model or inference target is not available in the selected Region or profile.';
    }
    // Service Unavailable
    else if (
      code === 'ServiceUnavailableException' ||
      code === 'serviceUnavailableException' ||
      message.includes('ServiceUnavailable')
    ) {
      rawMessage = 'Amazon Bedrock is temporarily unavailable. Try again shortly.';
    }
    // Model Not Ready
    else if (code === 'ModelNotReadyException' || message.includes('ModelNotReady')) {
      rawMessage = 'This Bedrock model is not ready. Try again shortly.';
    }
    // Model Timeout
    else if (code === 'ModelTimeoutException' || message.includes('ModelTimeout')) {
      rawMessage = 'Amazon Bedrock request timed out.';
    }
    // Validation Exception
    else if (code === 'ValidationException' || message.includes('ValidationException')) {
      const lower = message.toLowerCase();
      if (lower.includes('converse') || lower.includes('not supported') || lower.includes('unsupported model')) {
        rawMessage = 'This Bedrock model does not support the Converse API.';
      } else {
        rawMessage = `Bedrock request validation failed: ${message.replace(/^ValidationException:\s*/i, '')}`;
      }
    }
    // Endpoint / Network failure
    else if (
      code === 'NetworkingError' ||
      code === 'TimeoutError' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENOTFOUND' ||
      message.includes('getaddrinfo')
    ) {
      rawMessage = 'Amazon Bedrock could not be reached. Check your network or AWS Region configuration.';
    } else {
      rawMessage = message || 'Amazon Bedrock request failed.';
    }

    // Apply centralized AWS privacy sanitization before returning to user/browser
    return sanitizeAwsErrorMessage(rawMessage);
  }

  /**
   * Unified connection & status snapshot. Both getStatus() and getConnectionState()
   * read from this cached snapshot to eliminate duplicate AWS network calls.
   */
  public async getConnectionSnapshot(options?: { fresh?: boolean }): Promise<BedrockConnectionSnapshot> {
    const config = bedrockConfigService.getConfig();
    const key = this.getConfigKey();
    const now = Date.now();

    if (!options?.fresh && this.connectionSnapshot && this.connectionSnapshot.key === key && (now - this.connectionSnapshot.timestamp < 30000)) {
      return this.connectionSnapshot;
    }

    if (!config.region) {
      const snap: BedrockConnectionSnapshot = {
        connected: false,
        status: 'unavailable',
        reason: 'AWS Region required.',
        authSource: undefined,
        region: config.region,
        profile: config.profile,
        modelsCount: 0,
        timestamp: now,
        key,
      };
      this.connectionSnapshot = snap;
      return snap;
    }

    // 1. Verify AWS Identity via STS GetCallerIdentity
    const sts = bedrockClientFactory.getSTSClient(config.region, config.profile);
    try {
      await sts.send(new GetCallerIdentityCommand({}));
    } catch (err: any) {
      const snap: BedrockConnectionSnapshot = {
        connected: false,
        status: 'unavailable',
        reason: this.normalizeError(err, 'auth'),
        authSource: undefined,
        region: config.region,
        profile: config.profile,
        modelsCount: 0,
        timestamp: now,
        key,
      };
      this.connectionSnapshot = snap;
      return snap;
    }

    // 2. Verify Bedrock Control Plane Authorization via ListFoundationModels (limit: 1)
    const bedrock = bedrockClientFactory.getBedrockClient(config.region, config.profile);
    try {
      await bedrock.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' }));
    } catch (err: any) {
      // STS succeeded, but Bedrock is denied
      const snap: BedrockConnectionSnapshot = {
        connected: false,
        status: 'unavailable',
        reason: this.normalizeError(err, 'control-plane'),
        authSource: 'AWS identity resolved', // SAFE: No ARN, account ID, or UserId exposed!
        region: config.region,
        profile: config.profile,
        modelsCount: 0,
        timestamp: now,
        key,
      };
      this.connectionSnapshot = snap;
      return snap;
    }

    // 3. Both succeeded
    let modelsCount = 0;
    try {
      const models = await this.listModels();
      modelsCount = models.length;
    } catch {}

    const safeAuthSource = config.profile ? `AWS Profile: ${config.profile}` : 'AWS Default Credentials';

    const snap: BedrockConnectionSnapshot = {
      connected: true,
      status: 'available',
      authSource: safeAuthSource,
      region: config.region,
      profile: config.profile,
      modelsCount,
      timestamp: now,
      key,
    };
    this.connectionSnapshot = snap;
    return snap;
  }

  /**
   * Determine connection state through AWS STS identity and Bedrock control plane checks.
   */
  public async getConnectionState(options?: { fresh?: boolean }): Promise<{
    connected: boolean;
    authSource?: string;
    reason?: string;
    region?: string;
    profile?: string;
  }> {
    const snap = await this.getConnectionSnapshot(options);
    return {
      connected: snap.connected,
      authSource: snap.authSource,
      reason: snap.reason,
      region: snap.region,
      profile: snap.profile,
    };
  }

  public async getStatus(): Promise<{
    status: AIProviderStatus;
    reason?: string;
    modelsCount?: number;
  }> {
    const snap = await this.getConnectionSnapshot();
    return {
      status: snap.status,
      reason: snap.reason,
      modelsCount: snap.modelsCount,
    };
  }

  /**
   * Discovers text foundation models and inference profiles (cross-Region targets).
   */
  public async listModels(): Promise<AIModel[]> {
    const config = bedrockConfigService.getConfig();
    if (!config.region) return [];

    const cacheKey = this.getConfigKey();
    const now = Date.now();
    if (this.modelCache && this.modelCache.key === cacheKey && now - this.modelCache.timestamp < 60000) {
      return this.modelCache.models;
    }

    const bedrockClient = bedrockClientFactory.getBedrockClient(config.region, config.profile);
    const discoveredModels: AIModel[] = [];

    // 1. Discover Foundation Models (text conversational & streaming only)
    try {
      const fmRes = await bedrockClient.send(
        new ListFoundationModelsCommand({
          byOutputModality: 'TEXT',
        })
      );

      const fms = fmRes.modelSummaries || [];
      for (const fm of fms) {
        if (!fm.modelId) continue;

        // Skip session-incompatible targets
        if (this.sessionIncompatibleTargets.has(fm.modelId)) {
          continue;
        }

        // Ensure text input and output
        const hasTextInput = fm.inputModalities?.includes('TEXT');
        const hasTextOutput = fm.outputModalities?.includes('TEXT');
        const streamingSupported = Boolean(fm.responseStreamingSupported);

        if (!hasTextInput || !hasTextOutput || !streamingSupported) {
          continue;
        }

        // Filter out legacy models
        if (fm.modelLifecycle?.status === 'LEGACY') {
          continue;
        }

        // Distinguish verified Converse-compatible from unknown
        const isConverseCompatible = isKnownConverseSupported(fm.modelId);

        // Record internal inference target mapping
        this.inferenceTargets.set(fm.modelId, {
          publicId: fm.modelId,
          invocationTarget: fm.modelId,
          type: 'foundation-model',
        });

        discoveredModels.push({
          id: fm.modelId,
          providerId: this.id,
          displayName: fm.modelName || fm.modelId,
          executionLocation: 'cloud',
          billingType: 'metered',
          supportsStreaming: isConverseCompatible ? true : undefined,
          family: fm.providerName,
          providerDisplayName: fm.providerName,
        });
      }
    } catch (err: any) {
      console.warn(`[BedrockAdapter] Failed to list foundation models: ${this.normalizeError(err, 'control-plane')}`);
    }

    // 2. Discover Inference Profiles
    try {
      let nextToken: string | undefined = undefined;
      do {
        const ipRes: any = await bedrockClient.send(
          new ListInferenceProfilesCommand({
            maxResults: 100,
            nextToken,
          })
        );

        const summaries = ipRes.inferenceProfileSummaries || [];
        for (const ip of summaries) {
          const publicId = ip.inferenceProfileId || (ip.inferenceProfileArn ? ip.inferenceProfileArn.split('/').pop() : undefined);
          if (!publicId || ip.status !== 'ACTIVE') continue;

          // Only show system-defined or application inference profiles
          const ipType = ip.type;
          if (ipType !== 'SYSTEM_DEFINED' && ipType !== 'APPLICATION') {
            continue;
          }

          // Skip session-incompatible targets
          if (this.sessionIncompatibleTargets.has(publicId)) {
            continue;
          }

          // Inspect underlying models
          const underlyingModelIds: string[] = [];
          const destinationRegions = new Set<string>();

          if (Array.isArray(ip.models)) {
            for (const m of ip.models) {
              if (!m.modelArn) continue;
              // Extract region: arn:aws:bedrock:<region>::foundation-model/...
              const regMatch = m.modelArn.match(/arn:aws[a-z0-9-]*:bedrock:([a-z0-9-]+):/i);
              if (regMatch && regMatch[1]) {
                destinationRegions.add(regMatch[1].toLowerCase());
              }
              // Extract model identifier
              const parts = m.modelArn.split('/');
              const mId = parts[parts.length - 1];
              if (mId) {
                underlyingModelIds.push(mId);
              }
            }
          }

          // Check underlying model compatibility
          const hasIncompatibleUnderlying = underlyingModelIds.some((mid) => this.sessionIncompatibleTargets.has(mid));
          if (hasIncompatibleUnderlying) {
            continue;
          }

          const hasKnownCompatibleUnderlying = underlyingModelIds.some((mid) => isKnownConverseSupported(mid));
          let profileSupportsStreaming: boolean | undefined = undefined;
          if (hasKnownCompatibleUnderlying) {
            profileSupportsStreaming = true;
          } else if (underlyingModelIds.length > 0) {
            profileSupportsStreaming = undefined;
          }

          // Determine cross-Region routing accurately
          let isCrossRegion: boolean | undefined = undefined;
          if (ipType === 'SYSTEM_DEFINED') {
            const targetLower = publicId.toLowerCase();
            if (
              destinationRegions.size > 1 ||
              targetLower.startsWith('us.') ||
              targetLower.startsWith('eu.') ||
              targetLower.startsWith('apac.') ||
              targetLower.startsWith('global.')
            ) {
              isCrossRegion = true;
            } else if (destinationRegions.size === 1) {
              isCrossRegion = false;
            } else {
              isCrossRegion = undefined;
            }
          } else if (ipType === 'APPLICATION') {
            // APPLICATION profiles: derive strictly from reliable destination region count
            if (destinationRegions.size > 1) {
              isCrossRegion = true;
            } else if (destinationRegions.size === 1) {
              isCrossRegion = false;
            } else {
              isCrossRegion = undefined;
            }
          }

          // AWS Invocation target semantics:
          // SYSTEM_DEFINED: public ID or ARN works; prefer public ID
          // APPLICATION: MUST use inferenceProfileArn
          const invocationTarget = ipType === 'APPLICATION'
            ? (ip.inferenceProfileArn || publicId)
            : (ip.inferenceProfileId || ip.inferenceProfileArn);

          this.inferenceTargets.set(publicId, {
            publicId,
            invocationTarget,
            type: ipType === 'APPLICATION' ? 'application-inference-profile' : 'system-inference-profile',
          });

          // Format clean display name with [Inference Profile] tag
          const cleanName = ip.inferenceProfileName || publicId;
          const displayName = `${cleanName} [Inference Profile]`;

          // Deduplicate if already present
          if (!discoveredModels.some((m) => m.id === publicId)) {
            discoveredModels.push({
              id: publicId, // ALWAYS public ID, NEVER the account-bearing ARN!
              providerId: this.id,
              displayName,
              executionLocation: 'cloud',
              billingType: 'metered',
              supportsStreaming: profileSupportsStreaming,
              isCrossRegion,
              inferenceProfileType: ipType,
              providerDisplayName: 'AWS Bedrock',
            });
          }
        }

        nextToken = ipRes.nextToken;
      } while (nextToken);
    } catch (err: any) {
      console.warn(`[BedrockAdapter] Failed to list inference profiles: ${this.normalizeError(err, 'control-plane')}`);
    }

    // Sort models: popular providers first (Anthropic, Amazon, Meta), then alphabetical
    const sorted = discoveredModels.sort((a, b) => {
      const getPriority = (name: string) => {
        if (name.includes('Claude') || name.includes('anthropic')) return 1;
        if (name.includes('Nova') || name.includes('Amazon')) return 2;
        if (name.includes('Llama') || name.includes('Meta')) return 3;
        return 4;
      };
      const pA = getPriority(a.displayName);
      const pB = getPriority(b.displayName);
      if (pA !== pB) return pA - pB;
      return a.displayName.localeCompare(b.displayName);
    });

    this.modelCache = {
      models: sorted,
      timestamp: now,
      key: cacheKey,
    };

    return sorted;
  }

  /**
   * Streams response via BedrockRuntimeClient.ConverseStreamCommand
   */
  public async generate(
    request: AIGenerateRequest,
    onStream: (event: AIStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<AIUsage> {
    const config = bedrockConfigService.getConfig();
    if (!config.region) {
      throw new Error('AWS Region is not configured for Bedrock.');
    }

    // Ensure models are discovered and internal target mapping is populated
    if (this.inferenceTargets.size === 0) {
      await this.listModels();
    }

    // Resolve public model ID to provider-native invocation target
    const target = this.inferenceTargets.get(request.modelId);
    if (!target) {
      throw new Error('The selected Bedrock inference target is no longer available. Refresh Bedrock models and try again.');
    }

    const runtimeClient = bedrockClientFactory.getBedrockRuntimeClient(config.region, config.profile);
    const startTime = Date.now();

    const input: ConverseStreamCommandInput = {
      modelId: target.invocationTarget, // AWS-native target (e.g. ARN for application profiles)
      messages: [
        {
          role: 'user',
          content: [{ text: request.prompt }],
        },
      ],
    };

    if (request.system && request.system.trim()) {
      input.system = [{ text: request.system.trim() }];
    }

    let inputTokenCount: number | undefined = undefined;
    let outputTokenCount: number | undefined = undefined;
    let status: 'completed' | 'cancelled' | 'error' = 'completed';
    let errorMessage: string | undefined = undefined;

    try {
      const command = new ConverseStreamCommand(input);

      // Send command with abortSignal attached for native cancellation
      const response = await runtimeClient.send(command, { abortSignal });

      if (!response.stream) {
        throw new Error('Bedrock returned an empty stream.');
      }

      for await (const chunk of response.stream) {
        if (abortSignal?.aborted) {
          status = 'cancelled';
          break;
        }

        // 1. Text delta
        if (chunk.contentBlockDelta?.delta?.text) {
          onStream({
            type: 'text-delta',
            textDelta: chunk.contentBlockDelta.delta.text,
          });
        }

        // 2. Token usage metadata
        if (chunk.metadata?.usage) {
          inputTokenCount = chunk.metadata.usage.inputTokens;
          outputTokenCount = chunk.metadata.usage.outputTokens;
        }

        // 3. Handle stream errors inside chunk
        if (chunk.internalServerException) {
          throw chunk.internalServerException;
        }
        if (chunk.modelStreamErrorException) {
          throw chunk.modelStreamErrorException;
        }
        if (chunk.serviceUnavailableException) {
          throw chunk.serviceUnavailableException;
        }
        if (chunk.throttlingException) {
          throw chunk.throttlingException;
        }
        if (chunk.validationException) {
          throw chunk.validationException;
        }
      }

      if (abortSignal?.aborted) {
        status = 'cancelled';
      }
    } catch (err: any) {
      if (abortSignal?.aborted || err.name === 'AbortError') {
        status = 'cancelled';
      } else {
        status = 'error';
        errorMessage = this.normalizeError(err, 'runtime');
        if (errorMessage === 'This Bedrock model does not support the Converse API.') {
          this.sessionIncompatibleTargets.add(request.modelId);
          this.modelCache = null; // Invalidate model cache so target is excluded
        }
        onStream({
          type: 'error',
          error: errorMessage,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const usage: AIUsage = {
      providerId: this.id,
      modelId: request.modelId, // Public Minfy target ID (safe, no ARN)
      resolvedModelId: request.modelId, // Public Minfy target ID (safe, no ARN)
      executionLocation: 'cloud',
      billingType: 'metered',
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs,
      inputTokenCount,
      outputTokenCount,
      status,
      costDescription: 'AWS Bedrock on-demand metered billing',
    };

    onStream({
      type: 'completed',
      usage,
    });

    return usage;
  }
}

export const bedrockAdapter = new BedrockAdapter();
