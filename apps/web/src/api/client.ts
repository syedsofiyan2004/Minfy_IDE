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
  TerminalTicketResponse,
  ProviderManifest,
  ProviderManifestsResponse,
} from '@minfy/shared';

const API_BASE = '/api';

export function getRuntimeToken(): string | null {
  if (typeof window !== 'undefined') {
    // 1. Inspect URL fragment on initial load (#runtimeToken=...)
    if (window.location.hash) {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const token = params.get('runtimeToken');
      if (token) {
        sessionStorage.setItem('minfy_runtime_token', token);
        // Immediately scrub the secret token from browser history & URL bar
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        return token;
      }
    }

    // 2. Read from session storage
    return sessionStorage.getItem('minfy_runtime_token');
  }
  return null;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getRuntimeToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers as Record<string, string>),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const json: ApiResponse<T> = await res.json().catch(() => ({
    success: false,
    error: `HTTP error ${res.status}`,
  }));

  if (!json.success && !res.ok) {
    throw new Error(json.error || `HTTP error ${res.status}`);
  }
  if (!json.success && json.error) {
    throw new Error(json.error);
  }
  return json.data as T;
}

export const api = {
  getRuntimeToken,

  checkHealth: async (): Promise<{ status: string }> => {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },

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

  createTerminalTicket: async (workspaceId: string): Promise<TerminalTicketResponse> => {
    return fetchJson<TerminalTicketResponse>(`${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/terminal-ticket`, {
      method: 'POST',
    });
  },

  // AI Provider Foundation
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

  listProviderManifests: async (): Promise<ProviderManifestsResponse> => {
    return fetchJson<ProviderManifestsResponse>(`${API_BASE}/ai/manifests`);
  },

  createProviderManifest: async (manifest: any): Promise<ProviderManifest> => {
    return fetchJson<ProviderManifest>(`${API_BASE}/ai/manifests`, {
      method: 'POST',
      body: JSON.stringify(manifest),
    });
  },

  updateProviderManifest: async (id: string, manifest: any): Promise<ProviderManifest> => {
    return fetchJson<ProviderManifest>(`${API_BASE}/ai/manifests/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(manifest),
    });
  },

  deleteProviderManifest: async (id: string): Promise<void> => {
    await fetchJson<{ deleted: boolean }>(`${API_BASE}/ai/manifests/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  streamAIGenerate: async (
    request: AIGenerateRequest,
    onEvent: (event: AIStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<void> => {
    const token = getRuntimeToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(`${API_BASE}/ai/generate`, {
      method: 'POST',
      headers,
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
