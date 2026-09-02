import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  ApiResponse,
  AIProvidersResponse,
  AIModelsResponse,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
} from '@minfy/shared';
import { aiProviderRegistry } from '../services/ai/aiRegistry.js';

export const aiRouter = Router();

// GET /api/ai/providers
aiRouter.get('/providers', async (_req: Request, res: Response<ApiResponse<AIProvidersResponse>>) => {
  try {
    const providers = await aiProviderRegistry.listProviders();
    return res.json({
      success: true,
      data: { providers },
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
  try {
    const models = await aiProviderRegistry.listModels(req.params.id);
    return res.json({
      success: true,
      data: {
        providerId: req.params.id,
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

  // If client disconnects, abort generation
  req.on('close', () => {
    aiProviderRegistry.cancel(generationId);
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
