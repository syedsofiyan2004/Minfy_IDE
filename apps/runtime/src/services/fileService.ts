import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { Workspace, FileNode, FileContentResult, SaveFileResponse } from '@minfy/shared';
import { resolveSafeWorkspacePath, SecurityError } from '../security/pathGuard.js';
import { CONFIG } from '../config.js';

export class FileService {
  /**
   * Helper to detect if a buffer contains binary data (e.g. null bytes).
   */
  private isBinaryBuffer(buffer: Buffer): boolean {
    const checkLength = Math.min(buffer.length, CONFIG.BINARY_CHECK_BYTES);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  }

  public async listTree(workspace: Workspace, subPath: string = ''): Promise<FileNode[]> {
    const { absolutePath, relativePath } = resolveSafeWorkspacePath(workspace.rootPath, subPath);

    const entries = await fs.readdir(absolutePath, { withFileTypes: true });

    const nodes: FileNode[] = [];

    for (const entry of entries) {
      // Filter out root .git by default for clean IDE experience, but allow other dotfiles
      if (entry.name === '.git') {
        continue;
      }

      const entryRelPath = relativePath ? `${relativePath}/${entry.name}`.replace(/\\/g, '/') : entry.name;
      const isDirectory = entry.isDirectory();
      const ext = isDirectory ? undefined : path.extname(entry.name).toLowerCase();

      let hasChildren = false;
      if (isDirectory) {
        try {
          const childEntries = await fs.readdir(path.join(absolutePath, entry.name));
          hasChildren = childEntries.length > 0;
        } catch {
          hasChildren = false;
        }
      }

      nodes.push({
        id: `${workspace.id}:${entryRelPath}`,
        name: entry.name,
        path: entryRelPath,
        type: isDirectory ? 'directory' : 'file',
        extension: ext,
        hasChildren,
        isLoaded: false,
      });
    }

    // Sort: directories first, then alphabetical case-insensitive
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return nodes;
  }

  public async readFile(workspace: Workspace, subPath: string): Promise<FileContentResult> {
    const { absolutePath, relativePath } = resolveSafeWorkspacePath(workspace.rootPath, subPath);

    const stats = await fs.stat(absolutePath);
    if (stats.isDirectory()) {
      throw new Error(`Cannot read directory as file: ${relativePath}`);
    }

    const size = stats.size;

    // Check size limitation (2MB)
    if (size > CONFIG.MAX_FILE_SIZE_BYTES) {
      return {
        path: relativePath,
        size,
        isBinary: false,
        truncated: true,
        encoding: 'utf-8',
        content: undefined,
      };
    }

    // Read partial buffer to check binary
    const fd = await fs.open(absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size, CONFIG.BINARY_CHECK_BYTES));
      if (size > 0) {
        await fd.read(buffer, 0, buffer.length, 0);
      }

      if (this.isBinaryBuffer(buffer)) {
        return {
          path: relativePath,
          size,
          isBinary: true,
          encoding: 'binary',
          content: undefined,
        };
      }
    } finally {
      await fd.close();
    }

    // Read full utf-8 text
    const content = await fs.readFile(absolutePath, 'utf-8');
    return {
      path: relativePath,
      size,
      isBinary: false,
      encoding: 'utf-8',
      content,
    };
  }

  public async saveFile(workspace: Workspace, subPath: string, content: string): Promise<SaveFileResponse> {
    const { absolutePath, relativePath } = resolveSafeWorkspacePath(workspace.rootPath, subPath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    await fs.writeFile(absolutePath, content, 'utf-8');
    const stats = await fs.stat(absolutePath);

    return {
      saved: true,
      path: relativePath,
      size: stats.size,
      savedAt: new Date().toISOString(),
    };
  }

  public async createEntry(
    workspace: Workspace,
    subPath: string,
    type: 'file' | 'directory',
    initialContent: string = ''
  ): Promise<FileNode> {
    const { absolutePath, relativePath } = resolveSafeWorkspacePath(workspace.rootPath, subPath);

    if (!relativePath || relativePath === '.') {
      throw new Error('Cannot create entry at workspace root directly');
    }

    if (fsSync.existsSync(absolutePath)) {
      throw new Error(`Entry already exists at ${relativePath}`);
    }

    if (type === 'directory') {
      await fs.mkdir(absolutePath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, initialContent, 'utf-8');
    }

    const name = path.basename(absolutePath);
    return {
      id: `${workspace.id}:${relativePath.replace(/\\/g, '/')}`,
      name,
      path: relativePath.replace(/\\/g, '/'),
      type,
      extension: type === 'file' ? path.extname(name).toLowerCase() : undefined,
      hasChildren: false,
      isLoaded: true,
    };
  }

  public async deleteEntry(workspace: Workspace, subPath: string): Promise<void> {
    const { absolutePath, relativePath } = resolveSafeWorkspacePath(workspace.rootPath, subPath);

    if (!relativePath || relativePath === '.' || relativePath === '') {
      throw new SecurityError('Cannot delete workspace root directory');
    }

    const stats = await fs.lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      await fs.unlink(absolutePath);
    } else if (stats.isDirectory()) {
      await fs.rm(absolutePath, { recursive: true, force: true });
    } else {
      await fs.unlink(absolutePath);
    }
  }
}

export const fileService = new FileService();
