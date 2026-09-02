import {
  Workspace,
  FileNode,
  FileContentResult,
  ApiResponse,
  SaveFileResponse,
  CreateEntryResponse,
  RuntimeStatusResponse,
  ProjectIntelligence,
} from '@minfy/shared';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  const json: ApiResponse<T> = await res.json();
  if (!json.success && !res.ok) {
    throw new Error(json.error || `HTTP error ${res.status}`);
  }
  if (!json.success && json.error) {
    throw new Error(json.error);
  }
  return json.data as T;
}

export const api = {
  checkStatus: async (): Promise<RuntimeStatusResponse> => {
    return fetchJson<RuntimeStatusResponse>(`${API_BASE}/status`);
  },

  listWorkspaces: async (): Promise<Workspace[]> => {
    return fetchJson<Workspace[]>(`${API_BASE}/workspaces`);
  },

  getWorkspace: async (id: string): Promise<Workspace> => {
    return fetchJson<Workspace>(`${API_BASE}/workspaces/${id}`);
  },

  registerWorkspace: async (path: string): Promise<{ workspace: Workspace }> => {
    return fetchJson<{ workspace: Workspace }>(`${API_BASE}/workspaces`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  listTree: async (workspaceId: string, path: string = ''): Promise<{ path: string; items: FileNode[] }> => {
    const encoded = encodeURIComponent(path);
    return fetchJson<{ path: string; items: FileNode[] }>(`${API_BASE}/workspaces/${workspaceId}/tree?path=${encoded}`);
  },

  readFile: async (workspaceId: string, path: string): Promise<FileContentResult> => {
    const encoded = encodeURIComponent(path);
    return fetchJson<FileContentResult>(`${API_BASE}/workspaces/${workspaceId}/file?path=${encoded}`);
  },

  saveFile: async (workspaceId: string, path: string, content: string): Promise<SaveFileResponse> => {
    return fetchJson<SaveFileResponse>(`${API_BASE}/workspaces/${workspaceId}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    });
  },

  createEntry: async (
    workspaceId: string,
    path: string,
    type: 'file' | 'directory',
    initialContent?: string
  ): Promise<CreateEntryResponse> => {
    return fetchJson<CreateEntryResponse>(`${API_BASE}/workspaces/${workspaceId}/entry`, {
      method: 'POST',
      body: JSON.stringify({ path, type, initialContent }),
    });
  },

  deleteEntry: async (workspaceId: string, path: string): Promise<void> => {
    await fetchJson<void>(`${API_BASE}/workspaces/${workspaceId}/entry`, {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    });
  },

  getIntelligence: async (workspaceId: string, refresh = false): Promise<ProjectIntelligence> => {
    const query = refresh ? '?refresh=true' : '';
    return fetchJson<ProjectIntelligence>(`${API_BASE}/workspaces/${workspaceId}/intelligence${query}`);
  },

  refreshIntelligence: async (workspaceId: string): Promise<ProjectIntelligence> => {
    return fetchJson<ProjectIntelligence>(`${API_BASE}/workspaces/${workspaceId}/intelligence/refresh`, {
      method: 'POST',
    });
  },
};
