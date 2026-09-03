import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { BedrockAdapter } from '../src/services/ai/bedrock/bedrockAdapter.js';
import { bedrockClientFactory } from '../src/services/ai/bedrock/bedrockClientFactory.js';
import { bedrockConfigService } from '../src/services/ai/bedrock/bedrockConfigService.js';
import { credentialStore } from '../src/services/credentialStore.js';
import { aiProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { AIStreamEvent } from '@minfy/shared';

describe('AWS Bedrock Native Provider Adapter (Milestone 6)', () => {
  let adapter: BedrockAdapter;

  beforeEach(() => {
    adapter = new BedrockAdapter();
    bedrockClientFactory.setMockClients(null);
  });

  afterEach(() => {
    bedrockClientFactory.setMockClients(null);
  });

  describe('Authentication & Connection State', () => {
    it('returns disconnected when region is not configured', async () => {
      // Mock unconfigured config
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: undefined, profile: undefined, configured: false });

      try {
        const state = await adapter.getConnectionState();
        assert.strictEqual(state.connected, false);
        assert.strictEqual(state.reason, 'AWS Region required.');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('returns disconnected when AWS credentials cannot be resolved', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', profile: 'invalid-prof', configured: true });

      const mockSts = {
        send: async () => {
          const err: any = new Error('Could not load credentials from any providers');
          err.name = 'CredentialsProviderError';
          throw err;
        },
      };

      bedrockClientFactory.setMockClients({ stsClient: mockSts });

      try {
        const state = await adapter.getConnectionState();
        assert.strictEqual(state.connected, false);
        assert.strictEqual(state.reason, 'AWS credentials could not be resolved.');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('returns connected when STS identity resolves and Bedrock access is authorized', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', profile: 'minfy-dev', configured: true });

      const mockSts = {
        send: async () => ({
          Arn: 'arn:aws:iam::123456789012:user/developer',
          UserId: 'AIDAEXAMPLE',
          Account: '123456789012',
        }),
      };

      const mockBedrock = {
        send: async () => ({
          modelSummaries: [],
        }),
      };

      bedrockClientFactory.setMockClients({ stsClient: mockSts, bedrockClient: mockBedrock });

      try {
        const state = await adapter.getConnectionState();
        assert.strictEqual(state.connected, true);
        assert.strictEqual(state.authSource, 'AWS Profile: minfy-dev');
        assert.strictEqual(state.region, 'us-east-1');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('connection state does NOT depend on Minfy CredentialStore', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', configured: true });

      const mockSts = {
        send: async () => ({ Arn: 'arn:aws:sts::123:assumed-role/Test' }),
      };
      const mockBedrock = {
        send: async () => ({ modelSummaries: [] }),
      };

      bedrockClientFactory.setMockClients({ stsClient: mockSts, bedrockClient: mockBedrock });

      try {
        // Assert CredentialStore has NO record of bedrock
        assert.strictEqual(credentialStore.hasCredential('bedrock'), false);
        const state = await adapter.getConnectionState();
        assert.strictEqual(state.connected, true);
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('distinguishes AWS authentication success from Bedrock IAM AccessDeniedException', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', profile: 'restricted-user', configured: true });

      const mockSts = {
        send: async () => ({ Arn: 'arn:aws:iam::123456789012:user/restricted' }),
      };

      const mockBedrock = {
        send: async () => {
          const err: any = new Error('User is not authorized to perform: bedrock:ListFoundationModels');
          err.name = 'AccessDeniedException';
          throw err;
        },
      };

      bedrockClientFactory.setMockClients({ stsClient: mockSts, bedrockClient: mockBedrock });

      try {
        const state = await adapter.getConnectionState();
        assert.strictEqual(state.connected, false);
        assert.strictEqual(state.authSource, 'AWS Identity: arn:aws:iam::123456789012:user/restricted');
        assert.strictEqual(state.reason, 'AWS credentials are valid, but this identity does not have permission to use Amazon Bedrock.');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });
  });

  describe('Model & Inference Profile Discovery', () => {
    it('normalizes foundation models, filters non-text / non-streaming models, and discovers inference profiles', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', configured: true });

      const mockBedrock = {
        send: async (command: any) => {
          const cmdName = command.constructor.name;
          if (cmdName === 'ListFoundationModelsCommand') {
            return {
              modelSummaries: [
                {
                  modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
                  modelName: 'Claude 3.5 Sonnet',
                  providerName: 'Anthropic',
                  inputModalities: ['TEXT', 'IMAGE'],
                  outputModalities: ['TEXT'],
                  responseStreamingSupported: true,
                },
                {
                  modelId: 'amazon.titan-embed-text-v2:0',
                  modelName: 'Titan Text Embeddings V2',
                  providerName: 'Amazon',
                  inputModalities: ['TEXT'],
                  outputModalities: ['EMBEDDING'], // Embedding only -> must be filtered
                  responseStreamingSupported: false,
                },
                {
                  modelId: 'stability.stable-diffusion-xl-v1',
                  modelName: 'SDXL',
                  providerName: 'Stability AI',
                  inputModalities: ['TEXT'],
                  outputModalities: ['IMAGE'], // Image only -> must be filtered
                  responseStreamingSupported: false,
                },
              ],
            };
          }

          if (cmdName === 'ListInferenceProfilesCommand') {
            return {
              inferenceProfileSummaries: [
                {
                  inferenceProfileId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
                  inferenceProfileName: 'Claude 3.5 Sonnet v2',
                  type: 'SYSTEM_DEFINED',
                  status: 'ACTIVE',
                },
              ],
            };
          }

          return {};
        },
      };

      bedrockClientFactory.setMockClients({ bedrockClient: mockBedrock });

      try {
        const models = await adapter.listModels();
        assert.strictEqual(models.length, 2);

        const sonnet = models.find((m) => m.id === 'anthropic.claude-3-5-sonnet-20240620-v1:0');
        assert.ok(sonnet);
        assert.strictEqual(sonnet.displayName, 'Claude 3.5 Sonnet');
        assert.strictEqual(sonnet.executionLocation, 'cloud');
        assert.strictEqual(sonnet.billingType, 'metered');
        assert.strictEqual(sonnet.supportsStreaming, true);

        const profile = models.find((m) => m.id === 'us.anthropic.claude-3-5-sonnet-20241022-v2:0');
        assert.ok(profile);
        assert.strictEqual(profile.displayName, 'Claude 3.5 Sonnet v2 [Inference Profile]');
        assert.strictEqual(profile.isCrossRegion, true);
        assert.strictEqual(profile.inferenceProfileType, 'SYSTEM_DEFINED');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('handles empty region catalog gracefully without throwing', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'ap-south-1', configured: true });

      const mockBedrock = {
        send: async () => ({ modelSummaries: [], inferenceProfileSummaries: [] }),
      };

      bedrockClientFactory.setMockClients({ bedrockClient: mockBedrock });

      try {
        const models = await adapter.listModels();
        assert.strictEqual(Array.isArray(models), true);
        assert.strictEqual(models.length, 0);
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });
  });

  describe('ConverseStream Generation & Cancellation', () => {
    it('maps prompt and system correctly, streams text deltas, and captures usage metadata', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', configured: true });

      let receivedInput: any = null;

      const mockRuntime = {
        send: async (command: any) => {
          receivedInput = command.input;
          async function* generateStream() {
            yield { contentBlockDelta: { delta: { text: 'Hello ' } } };
            yield { contentBlockDelta: { delta: { text: 'from AWS Bedrock!' } } };
            yield {
              metadata: {
                usage: {
                  inputTokens: 14,
                  outputTokens: 7,
                },
              },
            };
          }
          return { stream: generateStream() };
        },
      };

      bedrockClientFactory.setMockClients({ runtimeClient: mockRuntime });

      const events: AIStreamEvent[] = [];
      try {
        const usage = await adapter.generate(
          {
            providerId: 'bedrock',
            modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
            prompt: 'Explain dependency injection',
            system: 'You are an expert tutor.',
          },
          (ev) => events.push(ev)
        );

        assert.strictEqual(receivedInput.modelId, 'us.anthropic.claude-3-5-sonnet-20241022-v2:0');
        assert.deepStrictEqual(receivedInput.messages, [
          { role: 'user', content: [{ text: 'Explain dependency injection' }] },
        ]);
        assert.deepStrictEqual(receivedInput.system, [{ text: 'You are an expert tutor.' }]);

        const textDeltas = events.filter((e) => e.type === 'text-delta').map((e) => e.textDelta).join('');
        assert.strictEqual(textDeltas, 'Hello from AWS Bedrock!');

        assert.strictEqual(usage.status, 'completed');
        assert.strictEqual(usage.inputTokenCount, 14);
        assert.strictEqual(usage.outputTokenCount, 7);
        assert.strictEqual(usage.executionLocation, 'cloud');
        assert.strictEqual(usage.billingType, 'metered');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('handles cancellation gracefully via AbortSignal', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', configured: true });

      const controller = new AbortController();

      const mockRuntime = {
        send: async () => {
          async function* generateStream() {
            yield { contentBlockDelta: { delta: { text: 'First chunk ' } } };
            controller.abort(); // Cancel during streaming
            yield { contentBlockDelta: { delta: { text: 'Second chunk' } } };
          }
          return { stream: generateStream() };
        },
      };

      bedrockClientFactory.setMockClients({ runtimeClient: mockRuntime });

      try {
        const events: AIStreamEvent[] = [];
        const usage = await adapter.generate(
          {
            providerId: 'bedrock',
            modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
            prompt: 'Long generation',
          },
          (ev) => events.push(ev),
          controller.signal
        );

        assert.strictEqual(usage.status, 'cancelled');
        const textDeltas = events.filter((e) => e.type === 'text-delta').map((e) => e.textDelta).join('');
        assert.strictEqual(textDeltas, 'First chunk ');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });
  });

  describe('Error Normalization', () => {
    it('normalizes ThrottlingException', () => {
      const err: any = new Error('Rate limit exceeded');
      err.name = 'ThrottlingException';
      assert.strictEqual(adapter.normalizeError(err), 'Amazon Bedrock is throttling requests. Try again shortly.');
    });

    it('normalizes ResourceNotFoundException', () => {
      const err: any = new Error('Model not found');
      err.name = 'ResourceNotFoundException';
      assert.strictEqual(
        adapter.normalizeError(err),
        'The selected Bedrock model or inference target is not available in the selected Region or profile.'
      );
    });

    it('normalizes runtime invocation AccessDeniedException', () => {
      const err: any = new Error('Access denied to model');
      err.name = 'AccessDeniedException';
      assert.strictEqual(
        adapter.normalizeError(err, 'runtime'),
        "You don't have permission to invoke this Bedrock model. Check your IAM policy for bedrock:InvokeModelWithResponseStream."
      );
    });

    it('normalizes ExpiredTokenException', () => {
      const err: any = new Error('Token expired');
      err.name = 'ExpiredTokenException';
      assert.strictEqual(
        adapter.normalizeError(err),
        'Your AWS session has expired. Sign in again using your configured AWS profile.'
      );
    });
  });

  describe('Registry Coexistence', () => {
    it('Ollama, OpenRouter, and Bedrock all coexist independently in AIProviderRegistry', async () => {
      const providers = await aiProviderRegistry.listProviders();
      const ids = providers.map((p) => p.id);

      assert.ok(ids.includes('ollama'), 'Ollama must be in providers');
      assert.ok(ids.includes('openrouter'), 'OpenRouter must be in providers');
      assert.ok(ids.includes('bedrock'), 'AWS Bedrock must be in providers');

      const bedrock = providers.find((p) => p.id === 'bedrock');
      assert.ok(bedrock);
      assert.strictEqual(bedrock.type, 'enterprise');
      assert.strictEqual(bedrock.source, 'built-in');
    });
  });
});
