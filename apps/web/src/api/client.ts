import {
  Workspace,
  FileNode,
  FileContentResult,
  ApiResponse,
  SaveFileResponse,
  CreateEntryResponse,
  RuntimeStatusResponse,
  ProjectIntelligence,
  AIProvidersResponse,
  AIModelsResponse,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
  ConnectProviderResponse,
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

  // AI Provider Foundation (Milestones 3, 3.1 & 4)
  listAIProviders: async (): Promise<AIProvidersResponse> => {
    return fetchJson<AIProvidersResponse>(`${API_BASE}/ai/providers`);
  },

  listAIModels: async (providerId: string): Promise<AIModelsResponse> => {
    return fetchJson<AIModelsResponse>(`${API_BASE}/ai/providers/${encodeURIComponent(providerId)}/models`);
  },

  connectAIProvider: async (providerId: string, apiKey: string): Promise<ConnectProviderResponse> => {
    return fetchJson<ConnectProviderResponse>(`${API_BASE}/ai/providers/${encodeURIComponent(providerId)}/connect`, {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    });
  },

  disconnectAIProvider: async (providerId: string): Promise<{ connected: boolean }> => {
    return fetchJson<{ connected: boolean }>(`${API_BASE}/ai/providers/${encodeURIComponent(providerId)}/connection`, {
      method: 'DELETE',
    });
  },

  streamAIGenerate: async (
    request: AIGenerateRequest,
    onEvent: (event: AIStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<void> => {
    const res = await fetch(`${API_BASE}/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: abortSignal,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error || `Generation request failed with HTTP ${res.status}`);
    }

    if (!res.body) {
      throw new Error('No response stream available');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (abortSignal?.aborted) {
        reader.cancel().catch(() => {});
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.replace(/^data:\s*/, '');
          if (dataStr === '[DONE]') continue;
          try {
            const event: AIStreamEvent = JSON.parse(dataStr);
            onEvent(event);
          } catch {
            // ignore partial json
          }
        }
      }
    }
  },

  getAIUsage: async (): Promise<{ history: AIUsage[] }> => {
    return fetchJson<{ history: AIUsage[] }>(`${API_BASE}/ai/usage`);
  },
};
