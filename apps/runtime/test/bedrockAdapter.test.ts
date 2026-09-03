import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { BedrockAdapter } from '../src/services/ai/bedrock/bedrockAdapter.js';
import { bedrockClientFactory } from '../src/services/ai/bedrock/bedrockClientFactory.js';
import { bedrockConfigService } from '../src/services/ai/bedrock/bedrockConfigService.js';
import { credentialStore } from '../src/services/credentialStore.js';
import { aiProviderRegistry } from '../src/services/ai/aiRegistry.js';
import { AIStreamEvent } from '@minfy/shared';

describe('AWS Bedrock Native Provider Adapter (Milestones 6 & 6.1)', () => {
  let adapter: BedrockAdapter;

  beforeEach(() => {
    adapter = new BedrockAdapter();
    bedrockClientFactory.setMockClients(null);
  });

  afterEach(() => {
    bedrockClientFactory.setMockClients(null);
  });

  describe('Authentication, Identity Privacy & Connection Cache', () => {
    it('returns disconnected when region is not configured', async () => {
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

    it('successful provider response contains no account ID and authSource is non-sensitive', async () => {
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
        // Identity privacy: Must NOT contain account ID or full ARN
        assert.strictEqual(state.authSource, 'AWS Profile: minfy-dev');
        assert.strictEqual(state.authSource?.includes('123456789012'), false);
        assert.strictEqual(state.authSource?.includes('arn:aws'), false);
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
        assert.strictEqual(credentialStore.hasCredential('bedrock'), false);
        const state = await adapter.getConnectionState();
        assert.strictEqual(state.connected, true);
        assert.strictEqual(state.authSource, 'AWS Default Credentials');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('access-denied provider response contains no ARN or account ID', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', profile: 'restricted-user', configured: true });

      const mockSts = {
        send: async () => ({
          Arn: 'arn:aws:iam::999888777666:user/restricted',
          Account: '999888777666',
        }),
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
        // Identity privacy: Never expose ARN or Account in authSource or reason
        assert.strictEqual(state.authSource, 'AWS identity resolved');
        assert.strictEqual(state.authSource?.includes('999888777666'), false);
        assert.strictEqual(state.reason, 'AWS credentials are valid, but this identity does not have permission to use Amazon Bedrock.');
        assert.strictEqual(state.reason?.includes('999888777666'), false);
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('connection cache avoids duplicate AWS calls and respects invalidation and fresh flag', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', profile: 'test-profile', configured: true });

      let stsCallCount = 0;
      let bedrockCallCount = 0;

      const mockSts = {
        send: async () => {
          stsCallCount++;
          return { Arn: 'arn:aws:iam::111:user/dev' };
        },
      };

      const mockBedrock = {
        send: async () => {
          bedrockCallCount++;
          return { modelSummaries: [] };
        },
      };

      bedrockClientFactory.setMockClients({ stsClient: mockSts, bedrockClient: mockBedrock });

      try {
        // First lookup: invokes STS and Bedrock
        await adapter.getStatus();
        assert.strictEqual(stsCallCount, 1);
        const callsAfterFirst = bedrockCallCount;
        assert.ok(callsAfterFirst >= 1);

        // Second lookup within cache window: zero additional AWS calls
        await adapter.getConnectionState();
        await adapter.getStatus();
        assert.strictEqual(stsCallCount, 1);
        assert.strictEqual(bedrockCallCount, callsAfterFirst);

        // Invalidation (e.g. region change) clears cache
        adapter.invalidateCache();
        await adapter.getStatus();
        assert.strictEqual(stsCallCount, 2);
        assert.ok(bedrockCallCount > callsAfterFirst);
        const callsAfterSecond = bedrockCallCount;

        // Explicit fresh check bypasses cache
        await adapter.getConnectionSnapshot({ fresh: true });
        assert.strictEqual(stsCallCount, 3);
        assert.ok(bedrockCallCount > callsAfterSecond);
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });
  });

  describe('Capability Accuracy & Model / Profile Discovery', () => {
    it('text + streaming model is NOT automatically called verified Converse-compatible unless compatibility is known', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', configured: true });

      const mockBedrock = {
        send: async (command: any) => {
          if (command.constructor.name === 'ListFoundationModelsCommand') {
            return {
              modelSummaries: [
                {
                  modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
                  modelName: 'Claude 3.5 Sonnet',
                  providerName: 'Anthropic',
                  inputModalities: ['TEXT'],
                  outputModalities: ['TEXT'],
                  responseStreamingSupported: true,
                },
                {
                  // Novel / unknown model that streams text, but is NOT known Converse-compatible
                  modelId: 'unknown-vendor.future-model-v1',
                  modelName: 'Future Novel Model',
                  providerName: 'Unknown Vendor',
                  inputModalities: ['TEXT'],
                  outputModalities: ['TEXT'],
                  responseStreamingSupported: true,
                },
              ],
            };
          }
          return { inferenceProfileSummaries: [] };
        },
      };

      bedrockClientFactory.setMockClients({ bedrockClient: mockBedrock });

      try {
        const models = await adapter.listModels();
        const claude = models.find((m) => m.id === 'anthropic.claude-3-5-sonnet-20240620-v1:0');
        const futureModel = models.find((m) => m.id === 'unknown-vendor.future-model-v1');

        assert.ok(claude);
        assert.strictEqual(claude.supportsStreaming, true, 'Known Converse model family has verified streaming support');

        assert.ok(futureModel);
        assert.strictEqual(
          futureModel.supportsStreaming,
          undefined,
          'Unknown model does NOT receive verified supportsStreaming: true'
        );
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('inference profiles inherit capabilities honestly from underlying models and represent routing accurately', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', configured: true });

      const mockBedrock = {
        send: async (command: any) => {
          if (command.constructor.name === 'ListFoundationModelsCommand') {
            return { modelSummaries: [] };
          }
          if (command.constructor.name === 'ListInferenceProfilesCommand') {
            return {
              inferenceProfileSummaries: [
                // 1. SYSTEM_DEFINED cross-region profile linked to known Claude model
                {
                  inferenceProfileId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
                  inferenceProfileName: 'Claude 3.5 Sonnet v2',
                  type: 'SYSTEM_DEFINED',
                  status: 'ACTIVE',
                  models: [
                    { modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0' },
                    { modelArn: 'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0' },
                  ],
                },
                // 2. APPLICATION profile with a SINGLE destination region (not cross-region)
                {
                  inferenceProfileId: 'app-single-region',
                  inferenceProfileName: 'App Single Region Profile',
                  type: 'APPLICATION',
                  status: 'ACTIVE',
                  models: [
                    { modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0' },
                  ],
                },
                // 3. APPLICATION profile with MULTIPLE destination regions (cross-region)
                {
                  inferenceProfileId: 'app-multi-region',
                  inferenceProfileName: 'App Multi Region Profile',
                  type: 'APPLICATION',
                  status: 'ACTIVE',
                  models: [
                    { modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0' },
                    { modelArn: 'arn:aws:bedrock:eu-central-1::foundation-model/amazon.nova-micro-v1:0' },
                  ],
                },
                // 4. Profile with unknown underlying model
                {
                  inferenceProfileId: 'unknown-profile',
                  inferenceProfileName: 'Unknown Profile',
                  type: 'APPLICATION',
                  status: 'ACTIVE',
                  models: [
                    { modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/custom.non-converse-model' },
                  ],
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

        // 1. SYSTEM_DEFINED
        const sysProf = models.find((m) => m.id === 'us.anthropic.claude-3-5-sonnet-20241022-v2:0');
        assert.ok(sysProf);
        assert.strictEqual(sysProf.supportsStreaming, true, 'Linked to known Claude model');
        assert.strictEqual(sysProf.isCrossRegion, true, 'System-defined US multi-region profile');

        // 2. APPLICATION single region
        const appSingle = models.find((m) => m.id === 'app-single-region');
        assert.ok(appSingle);
        assert.strictEqual(appSingle.supportsStreaming, true, 'Linked to known Nova model');
        assert.strictEqual(appSingle.isCrossRegion, false, 'Single region must NOT be falsely marked cross-region');

        // 3. APPLICATION multi region
        const appMulti = models.find((m) => m.id === 'app-multi-region');
        assert.ok(appMulti);
        assert.strictEqual(appMulti.isCrossRegion, true, 'Multiple destination regions marks cross-region');

        // 4. Unknown model profile
        const unkProf = models.find((m) => m.id === 'unknown-profile');
        assert.ok(unkProf);
        assert.strictEqual(unkProf.supportsStreaming, undefined, 'Unknown model does NOT receive supportsStreaming: true');
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });

    it('learning: target that fails with Converse unsupported is marked session-incompatible', async () => {
      const origGetConfig = bedrockConfigService.getConfig;
      bedrockConfigService.getConfig = () => ({ region: 'us-east-1', configured: true });

      const mockRuntime = {
        send: async () => {
          const err: any = new Error('ValidationException: The provided model does not support the Converse operation');
          err.name = 'ValidationException';
          throw err;
        },
      };

      bedrockClientFactory.setMockClients({ runtimeClient: mockRuntime });

      try {
        const events: AIStreamEvent[] = [];
        await adapter.generate(
          {
            providerId: 'bedrock',
            modelId: 'bad-model-v1',
            prompt: 'Test',
          },
          (ev) => events.push(ev)
        );

        const errorEv = events.find((e) => e.type === 'error');
        assert.ok(errorEv);
        assert.strictEqual(errorEv.error, 'This Bedrock model does not support the Converse API.');

        // Verify it was recorded in session incompatible set
        assert.strictEqual((adapter as any).sessionIncompatibleTargets.has('bad-model-v1'), true);
      } finally {
        bedrockConfigService.getConfig = origGetConfig;
      }
    });
  });

  describe('ConverseStream Service Errors', () => {
    it('normalizes ServiceUnavailableException', () => {
      const err: any = new Error('Service is down');
      err.name = 'ServiceUnavailableException';
      assert.strictEqual(
        adapter.normalizeError(err),
        'Amazon Bedrock is temporarily unavailable. Try again shortly.'
      );
    });

    it('normalizes ModelNotReadyException', () => {
      const err: any = new Error('Model is warming up');
      err.name = 'ModelNotReadyException';
      assert.strictEqual(
        adapter.normalizeError(err),
        'This Bedrock model is not ready. Try again shortly.'
      );
    });

    it('normalizes ModelTimeoutException', () => {
      const err: any = new Error('Invocation timed out');
      err.name = 'ModelTimeoutException';
      assert.strictEqual(
        adapter.normalizeError(err),
        'Amazon Bedrock request timed out.'
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
