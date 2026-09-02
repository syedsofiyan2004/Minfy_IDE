import {
  AIProviderType,
  AIProviderStatus,
  AIExecutionLocation,
  AIBillingType,
  AIModel,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
} from '@minfy/shared';
import { AIProviderAdapter } from '../types.js';

export interface OpenAICompatibleConfig {
  id: string;
  name: string;
  type: AIProviderType;
  baseUrl: string;
  requiresAuth?: boolean;
  getApiKey?: () => Promise<string | undefined> | string | undefined;
  defaultExecutionLocation?: AIExecutionLocation;
  defaultBillingType?: AIBillingType;
  modelClassifier?: (modelId: string, rawModel?: any) => {
    executionLocation: AIExecutionLocation;
    billingType?: AIBillingType;
    costDescription?: string;
  };
  customHeaders?: Record<string, string>;
  extraModels?: AIModel[];
}

export class OpenAICompatibleAdapter implements AIProviderAdapter {
  public readonly id: string;
  public readonly name: string;
  public readonly type: AIProviderType;
  public readonly requiresAuth: boolean;

  protected config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.requiresAuth = config.requiresAuth ?? true;
  }

  protected async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
    };

    if (this.config.getApiKey) {
      const key = await this.config.getApiKey();
      if (key) {
        headers['Authorization'] = `Bearer ${key.trim()}`;
      }
    }

    return headers;
  }

  public async getStatus(): Promise<{ status: AIProviderStatus; reason?: string; modelsCount?: number }> {
    if (this.requiresAuth && this.config.getApiKey) {
      const key = await this.config.getApiKey();
      if (!key) {
        return {
          status: 'unavailable',
          reason: `${this.name} is not connected. Enter API key to connect.`,
          modelsCount: 0,
        };
      }
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const headers = await this.getHeaders();
      const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/models`;

      const res = await fetch(endpoint, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 401 || res.status === 403) {
        return {
          status: 'unavailable',
          reason: `Authentication failed for ${this.name}. Check your API key.`,
          modelsCount: 0,
        };
      }

      if (res.status === 429) {
        return {
          status: 'degraded',
          reason: `${this.name} rate limit reached.`,
        };
      }

      if (!res.ok) {
        return {
          status: 'unavailable',
          reason: `${this.name} returned HTTP ${res.status}`,
          modelsCount: 0,
        };
      }

      const data: any = await res.json();
      const count = Array.isArray(data?.data) ? data.data.length : 0;

      return {
        status: 'available',
        modelsCount: count + (this.config.extraModels?.length || 0),
      };
    } catch {
      return {
        status: 'unavailable',
        reason: `${this.name} could not be reached.`,
        modelsCount: 0,
      };
    }
  }

  public async listModels(): Promise<AIModel[]> {
    if (this.requiresAuth && this.config.getApiKey) {
      const key = await this.config.getApiKey();
      if (!key) {
        return this.config.extraModels ? [...this.config.extraModels] : [];
      }
    }

    const models: AIModel[] = [];

    // Add extra pre-configured models first (e.g. openrouter/free)
    if (this.config.extraModels && this.config.extraModels.length > 0) {
      models.push(...this.config.extraModels);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const headers = await this.getHeaders();
      const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/models`;

      const res = await fetch(endpoint, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return models;
      }

      const data: any = await res.json();
      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          if (!item || !item.id) continue;
          if (models.some((m) => m.id === item.id)) continue;

          let location: AIExecutionLocation = this.config.defaultExecutionLocation || 'cloud';
          let billing: AIBillingType | undefined = this.config.defaultBillingType || 'unknown';

          if (this.config.modelClassifier) {
            const classified = this.config.modelClassifier(item.id, item);
            location = classified.executionLocation;
            billing = classified.billingType;
          }

          models.push({
            id: item.id,
            providerId: this.id,
            displayName: item.name || item.id,
            executionLocation: location,
            billingType: billing,
            contextWindow: item.context_length,
            supportsStreaming: true,
          });
        }
      }
    } catch (err) {
      console.warn(`[${this.name}] Failed to fetch dynamic models:`, err);
    }

    return models;
  }

  public async generate(
    request: AIGenerateRequest,
    onStream: (event: AIStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<AIUsage> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    let location: AIExecutionLocation = this.config.defaultExecutionLocation || 'cloud';
    let billing: AIBillingType | undefined = this.config.defaultBillingType || 'unknown';
    let costDesc = `${this.name} • Remote inference`;

    if (this.config.modelClassifier) {
      const classified = this.config.modelClassifier(request.modelId);
      location = classified.executionLocation;
      billing = classified.billingType;
      costDesc = classified.costDescription || costDesc;
    }

    onStream({ type: 'started' });

    const systemPrompt =
      request.system ||
      'You are the AI assistant inside Minfy IDE. Help developers with software engineering questions. Be concise and technically accurate.';

    try {
      const headers = await this.getHeaders();
      const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: request.modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: request.prompt },
          ],
          stream: true,
        }),
        signal: abortSignal,
      });

      if (!res.ok) {
        let errMessage = `${this.name} request failed (HTTP ${res.status})`;
        try {
          const errData: any = await res.json();
          if (errData?.error?.message) {
            errMessage = `${this.name}: ${errData.error.message}`;
          }
        } catch {
          const raw = await res.text().catch(() => '');
          if (raw) errMessage = `${this.name}: ${raw}`;
        }

        if (res.status === 401 || res.status === 403) {
          errMessage = `Authentication failed for ${this.name}. Check your API key.`;
        } else if (res.status === 429) {
          errMessage = `${this.name} rate limit reached.`;
        }

        throw new Error(errMessage);
      }

      if (!res.body) {
        throw new Error(`${this.name} returned an empty response body`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;

      while (true) {
        if (abortSignal?.aborted) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (!trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.replace(/^data:\s*/, '');
          if (dataStr === '[DONE]') {
            continue;
          }

          try {
            const chunk = JSON.parse(dataStr);
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta) {
              onStream({
                type: 'text-delta',
                textDelta: delta,
              });
            }

            if (chunk?.usage) {
              inputTokens = chunk.usage.prompt_tokens;
              outputTokens = chunk.usage.completion_tokens;
            }
          } catch {
            // ignore non-json partial chunk
          }
        }
      }

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      if (abortSignal?.aborted) {
        const usage: AIUsage = {
          providerId: this.id,
          modelId: request.modelId,
          executionLocation: location,
          billingType: billing,
          startedAt,
          completedAt,
          durationMs,
          inputTokenCount: inputTokens,
          outputTokenCount: outputTokens,
          status: 'cancelled',
          costDescription: costDesc,
        };
        onStream({ type: 'error', error: 'Generation stopped by user', usage });
        return usage;
      }

      const usage: AIUsage = {
        providerId: this.id,
        modelId: request.modelId,
        executionLocation: location,
        billingType: billing,
        startedAt,
        completedAt,
        durationMs,
        inputTokenCount: inputTokens,
        outputTokenCount: outputTokens,
        status: 'completed',
        costDescription: costDesc,
      };

      onStream({ type: 'usage', usage });
      onStream({ type: 'completed', usage });
      return usage;
    } catch (err: any) {
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;
      const isAbort = err.name === 'AbortError' || abortSignal?.aborted;

      const usage: AIUsage = {
        providerId: this.id,
        modelId: request.modelId,
        executionLocation: location,
        billingType: billing,
        startedAt,
        completedAt,
        durationMs,
        status: isAbort ? 'cancelled' : 'error',
        costDescription: costDesc,
      };

      if (isAbort) {
        onStream({ type: 'error', error: 'Generation stopped by user', usage });
      } else {
        // Redact any accidental tokens from error message
        const safeError = (err.message || 'AI request failed').replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
        onStream({ type: 'error', error: safeError, usage });
      }

      return usage;
    }
  }
}
