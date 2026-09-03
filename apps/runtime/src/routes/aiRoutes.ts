import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  ApiResponse,
  AIProvidersResponse,
  AIModelsResponse,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
  ConnectProviderRequest,
  ConnectProviderResponse,
  ProviderManifest,
  ProviderManifestsResponse,
  BedrockConfig,
  BedrockTestResult,
} from '@minfy/shared';
import { aiProviderRegistry } from '../services/ai/aiRegistry.js';
import { credentialStore } from '../services/credentialStore.js';
import { providerManifestService, assertValidProviderId } from '../services/ai/providerManifestService.js';
import { ProviderFactory } from '../services/ai/providerFactory.js';
import { bedrockConfigService } from '../services/ai/bedrock/bedrockConfigService.js';
import { bedrockAdapter } from '../services/ai/bedrock/bedrockAdapter.js';

export const aiRouter = Router();

// GET /api/ai/providers
aiRouter.get('/providers', async (_req: Request, res: Response<ApiResponse<AIProvidersResponse>>) => {
  try {
    const providers = await aiProviderRegistry.listProviders();
    const backendInfo = credentialStore.backendInfo();

    return res.json({
      success: true,
      data: {
        providers,
        credentialBackend: backendInfo.type,
        credentialBackendName: backendInfo.name,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to list AI providers',
    });
  }
});

// GET /api/ai/providers/:id/models
aiRouter.get('/providers/:id/models', async (req: Request<{ id: string }>, res: Response<ApiResponse<AIModelsResponse>>) => {
  let providerId: string;
  try {
    providerId = assertValidProviderId(req.params.id);
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider ID: ${err.message}`,
    });
  }

  try {
    const models = await aiProviderRegistry.listModels(providerId);
    return res.json({
      success: true,
      data: {
        providerId,
        models,
      },
    });
  } catch (err: any) {
    return res.status(404).json({
      success: false,
      error: err.message || 'Failed to list models',
    });
  }
});

// POST /api/ai/providers/:id/connect (Generic credential validation & persistence)
aiRouter.post('/providers/:id/connect', async (req: Request<{ id: string }, {}, ConnectProviderRequest>, res: Response<ApiResponse<ConnectProviderResponse>>) => {
  let providerId: string;
  try {
    providerId = assertValidProviderId(req.params.id);
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider ID: ${err.message}`,
    });
  }

  if (providerId === 'bedrock') {
    return res.status(400).json({
      success: false,
      error: 'AWS Bedrock uses standard AWS SDK credentials and named profiles. Configure Bedrock settings instead of entering an API key.',
    });
  }

  const { apiKey } = req.body;

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({
      success: false,
      error: 'API key is required to connect provider',
    });
  }

  const adapter = aiProviderRegistry.getAdapter(providerId);
  if (!adapter) {
    return res.status(404).json({
      success: false,
      error: `Provider not found: ${providerId}`,
    });
  }

  const cleanKey = apiKey.trim();

  // Generic credential validation via adapter capability before persistence
  if (adapter.validateCredential) {
    const check = await adapter.validateCredential(cleanKey);
    if (!check.valid) {
      return res.status(401).json({
        success: false,
        error: check.reason || `Authentication failed for ${adapter.name}. Check your API key.`,
      });
    }
  }

  // Persist only after successful validation
  await credentialStore.set(providerId, cleanKey);

  const status = await adapter.getStatus();
  const backendInfo = credentialStore.backendInfo();

  return res.json({
    success: true,
    data: {
      connected: true,
      modelsCount: status.modelsCount,
      credentialBackend: backendInfo.type,
    },
    message: `Connected ${adapter.name} successfully`,
  });
});

// DELETE /api/ai/providers/:id/connection
aiRouter.delete('/providers/:id/connection', async (req: Request<{ id: string }>, res: Response<ApiResponse<{ connected: boolean }>>) => {
  let providerId: string;
  try {
    providerId = assertValidProviderId(req.params.id);
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider ID: ${err.message}`,
    });
  }

  await credentialStore.delete(providerId);

  return res.json({
    success: true,
    data: { connected: false },
    message: `Disconnected ${providerId} successfully`,
  });
});

// ==========================================
// AWS Bedrock Configuration Endpoints (Milestone 6)
// ==========================================

// GET /api/ai/providers/bedrock/config
aiRouter.get('/providers/bedrock/config', (_req: Request, res: Response<ApiResponse<BedrockConfig>>) => {
  try {
    const config = bedrockConfigService.getConfig();
    return res.json({
      success: true,
      data: config,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to read Bedrock config',
    });
  }
});

// PUT /api/ai/providers/bedrock/config
aiRouter.put('/providers/bedrock/config', async (req: Request<{}, {}, { region?: string; profile?: string }>, res: Response<ApiResponse<BedrockConfig>>) => {
  try {
    const saved = bedrockConfigService.saveConfig(req.body);
    bedrockAdapter.invalidateCache();

    return res.json({
      success: true,
      data: saved,
      message: 'AWS Bedrock configuration updated successfully.',
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Invalid Bedrock configuration',
    });
  }
});

// POST /api/ai/providers/bedrock/test
aiRouter.post('/providers/bedrock/test', async (_req: Request, res: Response<ApiResponse<BedrockTestResult>>) => {
  try {
    const connState = await bedrockAdapter.getConnectionState();
    let modelsCount = 0;

    if (connState.connected) {
      try {
        const models = await bedrockAdapter.listModels();
        modelsCount = models.length;
      } catch {}
    }

    return res.json({
      success: true,
      data: {
        connected: connState.connected,
        identity: connState.authSource,
        modelsCount,
        reason: connState.reason,
      },
      message: connState.connected
        ? `Connected to AWS Bedrock in ${connState.region || 'default region'} (${modelsCount} inference targets available)`
        : connState.reason || 'Failed to connect to AWS Bedrock',
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to test Bedrock connection',
    });
  }
});

// ==========================================
// Provider Manifest Management Endpoints (Milestones 5 & 5.1)
// ==========================================

// GET /api/ai/manifests - List all custom provider manifests (including disabled)
aiRouter.get('/manifests', (_req: Request, res: Response<ApiResponse<ProviderManifestsResponse>>) => {
  try {
    const manifests = providerManifestService.listManifests();
    return res.json({
      success: true,
      data: { manifests },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to list provider manifests',
    });
  }
});

// POST /api/ai/manifests - Create and register a custom provider manifest
aiRouter.post('/manifests', (req: Request<{}, {}, any>, res: Response<ApiResponse<ProviderManifest>>) => {
  const validation = providerManifestService.validateManifest(req.body, true);
  if (!validation.valid || !validation.manifest) {
    return res.status(400).json({
      success: false,
      error: validation.error || 'Invalid provider manifest.',
    });
  }

  const manifest = validation.manifest;

  // Check if provider ID already exists in registry or in saved manifests
  if (aiProviderRegistry.getAdapter(manifest.id) || providerManifestService.getManifest(manifest.id)) {
    return res.status(400).json({
      success: false,
      error: `Provider ID "${manifest.id}" already exists.`,
    });
  }

  // Pre-validate adapter construction if provider is enabled
  let adapter: any = null;
  if (manifest.enabled !== false) {
    try {
      adapter = ProviderFactory.createProviderFromManifest(manifest);
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: `Failed to initialize adapter from manifest: ${err.message}`,
      });
    }
  }

  try {
    // 1. Persist manifest file to ~/.minfy/providers/
    providerManifestService.saveManifest(manifest);

    // 2. If enabled !== false, register adapter; rollback file on registration error
    if (manifest.enabled !== false && adapter) {
      try {
        aiProviderRegistry.registerAdapter(adapter);
      } catch (regErr: any) {
        try {
          providerManifestService.deleteManifest(manifest.id);
        } catch {}
        throw regErr;
      }
    }

    return res.status(201).json({
      success: true,
      data: manifest,
      message: `Custom provider "${manifest.name}" created successfully.`,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to create provider manifest.',
    });
  }
});

// PUT /api/ai/manifests/:id - Update an existing custom provider manifest
aiRouter.put('/manifests/:id', async (req: Request<{ id: string }, {}, any>, res: Response<ApiResponse<ProviderManifest>>) => {
  let providerId: string;
  try {
    providerId = assertValidProviderId(req.params.id);
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider ID: ${err.message}`,
    });
  }

  if (aiProviderRegistry.isBuiltIn(providerId)) {
    return res.status(400).json({
      success: false,
      error: `Built-in provider "${providerId}" cannot be modified.`,
    });
  }

  if (aiProviderRegistry.hasActiveGeneration(providerId)) {
    return res.status(409).json({
      success: false,
      error: `Cannot disable or modify this provider while a generation is active. Stop the generation first.`,
    });
  }

  const existing = providerManifestService.getManifest(providerId);
  if (!existing) {
    return res.status(404).json({
      success: false,
      error: `Provider manifest "${providerId}" not found.`,
    });
  }

  // Ensure ID in body matches path ID
  const payload = { ...req.body, id: providerId };
  const validation = providerManifestService.validateManifest(payload, false);
  if (!validation.valid || !validation.manifest) {
    return res.status(400).json({
      success: false,
      error: validation.error || 'Invalid provider manifest.',
    });
  }

  const updatedManifest = validation.manifest;

  // Pre-construct adapter if updated manifest is enabled
  let newAdapter: any = null;
  if (updatedManifest.enabled !== false) {
    try {
      newAdapter = ProviderFactory.createProviderFromManifest(updatedManifest);
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: `Failed to construct replacement adapter: ${err.message}`,
      });
    }
  }

  try {
    // 1. Save updated manifest
    providerManifestService.saveManifest(updatedManifest);

    // 2. Authentication Scheme Cleanup:
    // Whenever auth type changed from bearer to none, delete stored credential regardless of enabled state
    if (existing.auth.type === 'bearer' && updatedManifest.auth.type === 'none') {
      await credentialStore.delete(providerId);
    }

    // 3. Handle Enabled/Disabled transitions
    if (updatedManifest.enabled === false) {
      // Enabled -> Disabled: unregister adapter from registry, keep stored credential
      if (aiProviderRegistry.getAdapter(providerId)) {
        aiProviderRegistry.unregisterAdapter(providerId);
      }
    } else {
      // Disabled -> Enabled or Enabled -> Updated:
      // If bearer auth, recover persisted credential into hot cache so status/connection is immediate
      if (updatedManifest.auth.type === 'bearer') {
        await credentialStore.get(providerId);
      }
      aiProviderRegistry.registerAdapter(newAdapter);
    }

    return res.json({
      success: true,
      data: updatedManifest,
      message: `Provider "${updatedManifest.name}" updated successfully.`,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to update provider manifest.',
    });
  }
});

// DELETE /api/ai/manifests/:id - Delete a custom provider manifest
aiRouter.delete('/manifests/:id', async (req: Request<{ id: string }>, res: Response<ApiResponse<{ deleted: boolean }>>) => {
  let providerId: string;
  try {
    providerId = assertValidProviderId(req.params.id);
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider ID: ${err.message}`,
    });
  }

  if (aiProviderRegistry.isBuiltIn(providerId)) {
    return res.status(400).json({
      success: false,
      error: 'Built-in providers cannot be removed.',
    });
  }

  if (aiProviderRegistry.hasActiveGeneration(providerId)) {
    return res.status(409).json({
      success: false,
      error: `Cannot remove provider "${providerId}" while an active generation is in progress. Stop the generation first.`,
    });
  }

  try {
    // 1. Unregister adapter if registered
    if (aiProviderRegistry.getAdapter(providerId)) {
      aiProviderRegistry.unregisterAdapter(providerId);
    }

    // 2. Delete manifest file
    const deleted = providerManifestService.deleteManifest(providerId);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: `Provider manifest "${providerId}" not found.`,
      });
    }

    // 3. Remove any stored credentials
    await credentialStore.delete(providerId);

    return res.json({
      success: true,
      data: { deleted: true },
      message: `Custom provider "${providerId}" deleted successfully.`,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to delete provider manifest.',
    });
  }
});

// ==========================================
// Generation and Streaming Endpoints
// ==========================================

// POST /api/ai/generate (SSE stream)
aiRouter.post('/generate', async (req: Request<{}, {}, AIGenerateRequest>, res: Response) => {
  const { providerId, modelId, prompt, system } = req.body;

  if (!providerId || !modelId || !prompt) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: providerId, modelId, and prompt are required.',
    });
  }

  const generationId = `gen-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  // Configure Server-Sent Events headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Helper to send SSE event
  const sendEvent = (event: AIStreamEvent) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  // If client disconnects before completion, abort generation
  res.on('close', () => {
    if (!res.writableEnded) {
      aiProviderRegistry.cancel(generationId);
    }
  });

  try {
    await aiProviderRegistry.generate(
      generationId,
      { providerId, modelId, prompt, system },
      (event) => {
        sendEvent(event);
      }
    );
  } catch (err: any) {
    sendEvent({
      type: 'error',
      error: err.message || 'Generation error',
    });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

// POST /api/ai/cancel
aiRouter.post('/cancel', (req: Request<{}, {}, { generationId: string }>, res: Response<ApiResponse<{ cancelled: boolean }>>) => {
  const { generationId } = req.body;
  if (!generationId) {
    return res.status(400).json({ success: false, error: 'generationId is required' });
  }

  const cancelled = aiProviderRegistry.cancel(generationId);
  return res.json({
    success: true,
    data: { cancelled },
  });
});

// GET /api/ai/usage
aiRouter.get('/usage', (_req: Request, res: Response<ApiResponse<{ history: AIUsage[] }>>) => {
  const history = aiProviderRegistry.getUsageHistory();
  return res.json({
    success: true,
    data: { history },
  });
});
