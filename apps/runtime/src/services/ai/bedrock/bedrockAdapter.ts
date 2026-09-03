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

export class BedrockAdapter implements AIProviderAdapter {
  public readonly id = 'bedrock';
  public readonly name = 'AWS Bedrock';
  public readonly type: AIProviderType = 'enterprise';
  public readonly source: ProviderManifestSource = 'built-in';
  public readonly protocol = 'bedrock';

  // Cache discovery results for 60s
  private modelCache: { models: AIModel[]; timestamp: number; key: string } | null = null;
  // Cache status for 30s
  private statusCache: {
    status: AIProviderStatus;
    reason?: string;
    modelsCount?: number;
    timestamp: number;
    key: string;
  } | null = null;

  constructor() {
    bedrockConfigService.onConfigChange(() => {
      this.modelCache = null;
      this.statusCache = null;
    });
  }

  public invalidateCache(): void {
    this.modelCache = null;
    this.statusCache = null;
  }

  private getConfigKey(): string {
    const cfg = bedrockConfigService.getConfig();
    return `${cfg.region || 'none'}:${cfg.profile || 'none'}`;
  }

  public normalizeError(err: any, context?: 'auth' | 'control-plane' | 'runtime'): string {
    if (!err) return 'Unknown AWS error';

    const code = err.name || err.code || err.__type || '';
    const message = err.message || '';

    // Credential resolution failure
    if (
      code === 'CredentialsProviderError' ||
      message.includes('Could not load credentials from any providers') ||
      message.includes('CredentialsProviderError')
    ) {
      return 'AWS credentials could not be resolved.';
    }

    // Expired session / token
    if (
      code === 'ExpiredToken' ||
      code === 'ExpiredTokenException' ||
      message.includes('The security token included in the request is expired') ||
      message.includes('Token has expired')
    ) {
      return 'Your AWS session has expired. Sign in again using your configured AWS profile.';
    }

    // Access Denied / IAM Permissions
    if (code === 'AccessDeniedException' || code === 'UnauthorizedException' || message.includes('AccessDenied')) {
      if (context === 'runtime') {
        return "You don't have permission to invoke this Bedrock model. Check your IAM policy for bedrock:InvokeModelWithResponseStream.";
      }
      return 'AWS credentials are valid, but this identity does not have permission to use Amazon Bedrock.';
    }

    // Throttling
    if (code === 'ThrottlingException' || code === 'TooManyRequestsException' || message.includes('throttl')) {
      return 'Amazon Bedrock is throttling requests. Try again shortly.';
    }

    // Resource / Model Not Found
    if (code === 'ResourceNotFoundException' || message.includes('ResourceNotFound')) {
      return 'The selected Bedrock model or inference target is not available in the selected Region or profile.';
    }

    // Validation Exception
    if (code === 'ValidationException' || message.includes('ValidationException')) {
      return `Bedrock request validation failed: ${message.replace(/^ValidationException:\s*/i, '')}`;
    }

    // Endpoint / Network failure
    if (
      code === 'NetworkingError' ||
      code === 'TimeoutError' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENOTFOUND' ||
      message.includes('getaddrinfo')
    ) {
      return 'Amazon Bedrock could not be reached. Check your network or AWS Region configuration.';
    }

    return message || 'Amazon Bedrock request failed.';
  }

  /**
   * Determine connection state through AWS STS identity and Bedrock control plane checks.
   */
  public async getConnectionState(): Promise<{
    connected: boolean;
    authSource?: string;
    reason?: string;
    region?: string;
    profile?: string;
  }> {
    const config = bedrockConfigService.getConfig();

    if (!config.region) {
      return {
        connected: false,
        reason: 'AWS Region required.',
        region: config.region,
        profile: config.profile,
      };
    }

    // 1. Verify AWS Identity via STS GetCallerIdentity
    const sts = bedrockClientFactory.getSTSClient(config.region, config.profile);
    let identityArn: string | undefined;

    try {
      const stsRes = await sts.send(new GetCallerIdentityCommand({}));
      identityArn = stsRes.Arn;
    } catch (err: any) {
      return {
        connected: false,
        reason: this.normalizeError(err, 'auth'),
        region: config.region,
        profile: config.profile,
      };
    }

    // 2. Verify Bedrock Control Plane Authorization via ListFoundationModels (limit: 1)
    const bedrock = bedrockClientFactory.getBedrockClient(config.region, config.profile);
    try {
      await bedrock.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' }));
    } catch (err: any) {
      return {
        connected: false,
        authSource: identityArn ? `AWS Identity: ${identityArn}` : undefined,
        reason: this.normalizeError(err, 'control-plane'),
        region: config.region,
        profile: config.profile,
      };
    }

    return {
      connected: true,
      authSource: config.profile ? `AWS Profile: ${config.profile}` : 'AWS Default Credentials',
      region: config.region,
      profile: config.profile,
    };
  }

  public async getStatus(): Promise<{
    status: AIProviderStatus;
    reason?: string;
    modelsCount?: number;
  }> {
    const cacheKey = this.getConfigKey();
    const now = Date.now();

    if (this.statusCache && this.statusCache.key === cacheKey && now - this.statusCache.timestamp < 30000) {
      return {
        status: this.statusCache.status,
        reason: this.statusCache.reason,
        modelsCount: this.statusCache.modelsCount,
      };
    }

    const conn = await this.getConnectionState();
    let modelsCount = 0;

    if (conn.connected) {
      try {
        const models = await this.listModels();
        modelsCount = models.length;
      } catch {}
    }

    const status: AIProviderStatus = conn.connected ? 'available' : 'unavailable';
    const result = {
      status,
      reason: conn.reason,
      modelsCount,
    };

    this.statusCache = {
      ...result,
      timestamp: now,
      key: cacheKey,
    };

    return result;
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

        // Ensure text input and streaming supported
        const hasTextInput = fm.inputModalities?.includes('TEXT');
        const hasTextOutput = fm.outputModalities?.includes('TEXT');
        const supportsStreaming = Boolean(fm.responseStreamingSupported);

        if (!hasTextInput || !hasTextOutput || !supportsStreaming) {
          continue;
        }

        // Filter out legacy models
        if (fm.modelLifecycle?.status === 'LEGACY') {
          continue;
        }

        discoveredModels.push({
          id: fm.modelId,
          providerId: this.id,
          displayName: fm.modelName || fm.modelId,
          executionLocation: 'cloud',
          billingType: 'metered',
          supportsStreaming: true,
          family: fm.providerName,
          providerDisplayName: fm.providerName,
        });
      }
    } catch (err: any) {
      console.warn(`[BedrockAdapter] Failed to list foundation models: ${this.normalizeError(err, 'control-plane')}`);
    }

    // 2. Discover Inference Profiles (cross-Region targets)
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
          // Usable targets must have an ID or ARN and be ACTIVE
          const targetId = ip.inferenceProfileId || ip.inferenceProfileArn;
          if (!targetId || ip.status !== 'ACTIVE') continue;

          // Only show system-defined or application inference profiles
          const ipType = ip.type;
          if (ipType !== 'SYSTEM_DEFINED' && ipType !== 'APPLICATION') {
            continue;
          }

          // Format clean display name with [Inference Profile] tag
          const cleanName = ip.inferenceProfileName || targetId;
          const displayName = `${cleanName} [Inference Profile]`;

          // Deduplicate if already present
          if (!discoveredModels.some((m) => m.id === targetId)) {
            discoveredModels.push({
              id: targetId,
              providerId: this.id,
              displayName,
              executionLocation: 'cloud',
              billingType: 'metered',
              supportsStreaming: true,
              isCrossRegion: true,
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

    const runtimeClient = bedrockClientFactory.getBedrockRuntimeClient(config.region, config.profile);
    const startTime = Date.now();

    const input: ConverseStreamCommandInput = {
      modelId: request.modelId,
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
        onStream({
          type: 'error',
          error: errorMessage,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const usage: AIUsage = {
      providerId: this.id,
      modelId: request.modelId,
      resolvedModelId: request.modelId,
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
