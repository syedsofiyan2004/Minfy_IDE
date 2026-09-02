import { Router, Request, Response } from 'express';
import {
  RegisterWorkspaceRequest,
  RegisterWorkspaceResponse,
  ApiResponse,
  Workspace,
  TerminalTicketResponse,
} from '@minfy/shared';
import { workspaceService } from '../services/workspaceService.js';
import { terminalTicketService } from '../services/terminalTicketService.js';

export const workspaceRouter = Router();

workspaceRouter.post('/', async (req: Request<{}, {}, RegisterWorkspaceRequest>, res: Response<ApiResponse<RegisterWorkspaceResponse>>) => {
  try {
    const { path: targetPath } = req.body;
    if (!targetPath) {
      return res.status(400).json({ success: false, error: 'Path is required' });
    }

    const workspace = await workspaceService.registerWorkspace(targetPath);
    return res.json({
      success: true,
      data: { workspace },
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to register workspace',
    });
  }
});

workspaceRouter.get('/', (_req: Request, res: Response<ApiResponse<Workspace[]>>) => {
  const workspaces = workspaceService.listWorkspaces();
  return res.json({
    success: true,
    data: workspaces,
  });
});

workspaceRouter.get('/:id', (req: Request<{ id: string }>, res: Response<ApiResponse<Workspace>>) => {
  const workspace = workspaceService.getWorkspace(req.params.id);
  if (!workspace) {
    return res.status(404).json({
      success: false,
      error: `Workspace ${req.params.id} not found`,
    });
  }
  return res.json({
    success: true,
    data: workspace,
  });
});

// POST /api/workspaces/:id/terminal-ticket
workspaceRouter.post('/:id/terminal-ticket', (req: Request<{ id: string }>, res: Response<ApiResponse<TerminalTicketResponse>>) => {
  const workspace = workspaceService.getWorkspace(req.params.id);
  if (!workspace) {
    return res.status(404).json({
      success: false,
      error: `Workspace ${req.params.id} not found`,
    });
  }

  const { ticket, expiresAt } = terminalTicketService.createTicket(req.params.id);

  return res.json({
    success: true,
    data: { ticket, expiresAt },
  });
});
