import { Router, Request, Response } from 'express';
import {
  ApiResponse,
  ListTreeResponse,
  ReadFileResponse,
  SaveFileRequest,
  SaveFileResponse,
  CreateEntryRequest,
  CreateEntryResponse,
} from '@minfy/shared';
import { workspaceService } from '../services/workspaceService.js';
import { fileService } from '../services/fileService.js';
import { intelligenceService } from '../services/intelligenceService.js';
import { SecurityError } from '../security/pathGuard.js';

export const fileRouter = Router({ mergeParams: true });

function getWorkspaceOr404(workspaceId: string, res: Response) {
  const workspace = workspaceService.getWorkspace(workspaceId);
  if (!workspace) {
    res.status(404).json({
      success: false,
      error: `Workspace ${workspaceId} not found`,
    });
    return null;
  }
  return workspace;
}

function handleFileError(err: any, res: Response) {
  if (err instanceof SecurityError) {
    return res.status(403).json({
      success: false,
      error: `Security violation: ${err.message}`,
    });
  }
  if (err.code === 'ENOENT') {
    return res.status(404).json({
      success: false,
      error: err.message || 'File or directory not found',
    });
  }
  return res.status(500).json({
    success: false,
    error: err.message || 'Filesystem operation failed',
  });
}

// GET /api/workspaces/:id/tree?path=
fileRouter.get('/tree', async (req: Request<{ id: string }>, res: Response<ApiResponse<ListTreeResponse>>) => {
  const workspace = getWorkspaceOr404(req.params.id, res);
  if (!workspace) return;

  const subPath = (req.query.path as string) || '';

  try {
    const items = await fileService.listTree(workspace, subPath);
    return res.json({
      success: true,
      data: {
        path: subPath,
        items,
      },
    });
  } catch (err: any) {
    return handleFileError(err, res);
  }
});

// GET /api/workspaces/:id/file?path=
fileRouter.get('/file', async (req: Request<{ id: string }>, res: Response<ApiResponse<ReadFileResponse>>) => {
  const workspace = getWorkspaceOr404(req.params.id, res);
  if (!workspace) return;

  const subPath = req.query.path as string;
  if (!subPath) {
    return res.status(400).json({ success: false, error: 'Query parameter "path" is required' });
  }

  try {
    const fileResult = await fileService.readFile(workspace, subPath);
    return res.json({
      success: true,
      data: fileResult,
    });
  } catch (err: any) {
    return handleFileError(err, res);
  }
});

// PUT /api/workspaces/:id/file
fileRouter.put('/file', async (req: Request<{ id: string }, {}, SaveFileRequest>, res: Response<ApiResponse<SaveFileResponse>>) => {
  const workspace = getWorkspaceOr404(req.params.id, res);
  if (!workspace) return;

  const { path: subPath, content } = req.body;
  if (!subPath || content === undefined) {
    return res.status(400).json({ success: false, error: 'Parameters "path" and "content" are required' });
  }

  try {
    const result = await fileService.saveFile(workspace, subPath, content);
    intelligenceService.invalidateCache(workspace.id);
    return res.json({
      success: true,
      data: result,
      message: 'File saved successfully',
    });
  } catch (err: any) {
    return handleFileError(err, res);
  }
});

// POST /api/workspaces/:id/entry
fileRouter.post('/entry', async (req: Request<{ id: string }, {}, CreateEntryRequest>, res: Response<ApiResponse<CreateEntryResponse>>) => {
  const workspace = getWorkspaceOr404(req.params.id, res);
  if (!workspace) return;

  const { path: subPath, type, initialContent } = req.body;
  if (!subPath || !type) {
    return res.status(400).json({ success: false, error: 'Parameters "path" and "type" are required' });
  }

  try {
    const node = await fileService.createEntry(workspace, subPath, type, initialContent);
    intelligenceService.invalidateCache(workspace.id);
    return res.json({
      success: true,
      data: { node },
      message: `${type === 'directory' ? 'Folder' : 'File'} created successfully`,
    });
  } catch (err: any) {
    return handleFileError(err, res);
  }
});

// DELETE /api/workspaces/:id/entry
fileRouter.delete('/entry', async (req: Request<{ id: string }>, res: Response<ApiResponse>) => {
  const workspace = getWorkspaceOr404(req.params.id, res);
  if (!workspace) return;

  const subPath = (req.query.path as string) || req.body?.path;
  if (!subPath) {
    return res.status(400).json({ success: false, error: 'Path is required for deletion' });
  }

  try {
    await fileService.deleteEntry(workspace, subPath);
    intelligenceService.invalidateCache(workspace.id);
    return res.json({
      success: true,
      message: 'Deleted successfully',
    });
  } catch (err: any) {
    return handleFileError(err, res);
  }
});
