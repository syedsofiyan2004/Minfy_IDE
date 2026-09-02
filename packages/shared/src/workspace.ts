export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  openedAt: string;
}

export type FileNodeType = 'file' | 'directory';

export interface FileNode {
  id: string;
  name: string;
  path: string; // Relative to workspace root
  type: FileNodeType;
  size?: number;
  extension?: string;
  hasChildren?: boolean;
  children?: FileNode[];
  isLoaded?: boolean;
}

export interface FileContentResult {
  path: string;
  content?: string;
  isBinary: boolean;
  size: number;
  truncated?: boolean;
  encoding: 'utf-8' | 'binary';
}
