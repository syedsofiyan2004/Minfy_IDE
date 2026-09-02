import { Router, Request, Response } from 'express';
import { ApiResponse, ProjectIntelligence } from '@minfy/shared';
import { workspaceService } from '../services/workspaceService.js';
import { intelligenceService } from '../services/intelligenceService.js';

export const intelligenceRouter = Router({ mergeParams: true });

intelligenceRouter.get('/', async (req: Request<{ id: string }>, res: Response<ApiResponse<ProjectIntelligence>>) => {
  const workspace = workspaceService.getWorkspace(req.params.id);
  if (!workspace) {
    return res.status(404).json({
      success: false,
      error: `Workspace ${req.params.id} not found`,
    });
  }

  const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';

  try {
    const intelligence = await intelligenceService.analyzeWorkspace(workspace, forceRefresh);
    return res.json({
      success: true,
      data: intelligence,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to analyze project intelligence',
    });
  }
});

intelligenceRouter.post('/refresh', async (req: Request<{ id: string }>, res: Response<ApiResponse<ProjectIntelligence>>) => {
  const workspace = workspaceService.getWorkspace(req.params.id);
  if (!workspace) {
    return res.status(404).json({
      success: false,
      error: `Workspace ${req.params.id} not found`,
    });
  }

  try {
    intelligenceService.invalidateCache(workspace.id);
    const intelligence = await intelligenceService.analyzeWorkspace(workspace, true);
    return res.json({
      success: true,
      data: intelligence,
      message: 'Project intelligence refreshed',
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to refresh intelligence',
    });
  }
});
