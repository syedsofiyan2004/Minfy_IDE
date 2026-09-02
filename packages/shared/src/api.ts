import { Workspace, FileNode, FileContentResult } from './workspace.js';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface RegisterWorkspaceRequest {
  path: string;
}

export interface RegisterWorkspaceResponse {
  workspace: Workspace;
}

export interface ListTreeRequest {
  path?: string; // default '' = root
}

export interface ListTreeResponse {
  path: string;
  items: FileNode[];
}

export interface ReadFileResponse extends FileContentResult {}

export interface SaveFileRequest {
  path: string;
  content: string;
}

export interface SaveFileResponse {
  saved: boolean;
  path: string;
  size: number;
  savedAt: string;
}

export interface CreateEntryRequest {
  path: string;
  type: 'file' | 'directory';
  initialContent?: string;
}

export interface CreateEntryResponse {
  node: FileNode;
}

export interface DeleteEntryRequest {
  path: string;
}

export interface RuntimeStatusResponse {
  status: 'ok';
  version: string;
  platform: string;
  workspacesCount: number;
  pid: number;
  runtimeInstanceId: string;
}
