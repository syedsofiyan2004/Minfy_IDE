import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Workspace } from '@minfy/shared';
import { CONFIG } from '../config.js';

export class WorkspaceService {
  private workspaces: Map<string, Workspace> = new Map();
  private recentWorkspaces: Workspace[] = [];

  constructor() {
    this.ensureDataDir();
    this.loadPersisted();
  }

  private ensureDataDir() {
    try {
      if (!fsSync.existsSync(CONFIG.DATA_DIR)) {
        fsSync.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
      }
    } catch (err) {
      console.error('Failed to create data directory:', err);
    }
  }

  private loadPersisted() {
    try {
      if (fsSync.existsSync(CONFIG.WORKSPACES_FILE)) {
        const raw = fsSync.readFileSync(CONFIG.WORKSPACES_FILE, 'utf-8');
        if (!raw || !raw.trim()) return;
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          this.recentWorkspaces = data.filter((w) => w && w.id && w.rootPath && fsSync.existsSync(w.rootPath));
          for (const w of this.recentWorkspaces) {
            this.workspaces.set(w.id, w);
          }
        }
      }
    } catch (err) {
      console.warn('Could not load workspaces.json, starting fresh:', err);
    }
  }

  private async persist() {
    try {
      this.ensureDataDir();
      const list = Array.from(this.workspaces.values());
      await fs.writeFile(CONFIG.WORKSPACES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save workspaces.json:', err);
    }
  }

  public async registerWorkspace(targetPath: string): Promise<Workspace> {
    const resolvedPath = path.resolve(targetPath);

    // Validate that path exists and is a directory
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${resolvedPath}`);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`Directory does not exist: ${resolvedPath}`);
      }
      throw err;
    }

    // Generate deterministic ID from canonical path
    const id = crypto.createHash('sha256').update(resolvedPath.toLowerCase()).digest('hex').substring(0, 12);
    const name = path.basename(resolvedPath) || resolvedPath;

    const workspace: Workspace = {
      id,
      name,
      rootPath: resolvedPath,
      openedAt: new Date().toISOString(),
    };

    this.workspaces.set(id, workspace);
    await this.persist();
    return workspace;
  }

  public getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  public listWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values());
  }
}

export const workspaceService = new WorkspaceService();
