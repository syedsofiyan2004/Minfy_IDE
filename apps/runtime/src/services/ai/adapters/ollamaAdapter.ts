import {
  AIProviderStatus,
  AIModel,
  AIGenerateRequest,
  AIStreamEvent,
  AIUsage,
} from '@minfy/shared';
import { AIProviderAdapter } from '../types.js';

export class OllamaAdapter implements AIProviderAdapter {
  public readonly id = 'ollama';
  public readonly name = 'Ollama';
  public readonly type = 'local' as const;

  private endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  }

  public getEndpoint(): string {
    return this.endpoint;
  }

  public async getStatus(): Promise<{ status: AIProviderStatus; reason?: string; modelsCount?: number }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const res = await fetch(`${this.endpoint}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return {
          status: 'unavailable',
          reason: `Ollama returned HTTP ${res.status}`,
        };
      }

      const data: any = await res.json();
      const modelsCount = Array.isArray(data?.models) ? data.models.length : 0;

      if (modelsCount === 0) {
        return {
          status: 'available',
          reason: 'Ollama is running, but no local models are installed.',
          modelsCount: 0,
        };
      }

      return {
        status: 'available',
        modelsCount,
      };
    } catch {
      return {
        status: 'unavailable',
        reason: 'Ollama is not running or could not be reached on this machine.',
        modelsCount: 0,
      };
    }
  }

  public async listModels(): Promise<AIModel[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${this.endpoint}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return [];
      }

      const data: any = await res.json();
      if (!Array.isArray(data?.models)) {
        return [];
      }

      return data.models.map((m: any) => ({
        id: m.name,
        providerId: this.id,
        displayName: m.name,
        sizeBytes: m.size,
        family: m.details?.family,
        parameterSize: m.details?.parameter_size,
        supportsStreaming: true,
      }));
    } catch {
      return [];
    }
  }

  public async generate(
    request: AIGenerateRequest,
    onStream: (event: AIStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<AIUsage> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    onStream({ type: 'started' });

    const systemPrompt =
      request.system ||
      'You are the AI assistant inside Minfy IDE. Help developers with software engineering questions. Be concise and technically accurate.';

    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.modelId,
          prompt: request.prompt,
          system: systemPrompt,
          stream: true,
        }),
        signal: abortSignal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Ollama generation failed (HTTP ${res.status}): ${errText || res.statusText}`);
      }

      if (!res.body) {
        throw new Error('Ollama response body is empty');
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

          try {
            const chunk = JSON.parse(trimmed);
            if (chunk.response) {
              onStream({
                type: 'text-delta',
                textDelta: chunk.response,
              });
            }

            if (chunk.done) {
              if (chunk.prompt_eval_count !== undefined) {
                inputTokens = chunk.prompt_eval_count;
              }
              if (chunk.eval_count !== undefined) {
                outputTokens = chunk.eval_count;
              }
            }
          } catch {
            // ignore partial json chunk
          }
        }
      }

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      if (abortSignal?.aborted) {
        const usage: AIUsage = {
          providerId: this.id,
          modelId: request.modelId,
          startedAt,
          completedAt,
          durationMs,
          inputTokenCount: inputTokens,
          outputTokenCount: outputTokens,
          status: 'cancelled',
          costDescription: 'Local provider • No API charge',
        };
        onStream({ type: 'error', error: 'Generation stopped by user', usage });
        return usage;
      }

      const usage: AIUsage = {
        providerId: this.id,
        modelId: request.modelId,
        startedAt,
        completedAt,
        durationMs,
        inputTokenCount: inputTokens,
        outputTokenCount: outputTokens,
        status: 'completed',
        costDescription: 'Local provider • No API charge',
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
        startedAt,
        completedAt,
        durationMs,
        status: isAbort ? 'cancelled' : 'error',
        costDescription: 'Local provider • No API charge',
      };

      if (isAbort) {
        onStream({ type: 'error', error: 'Generation stopped by user', usage });
      } else {
        onStream({ type: 'error', error: err.message || 'AI generation failed', usage });
      }

      return usage;
    }
  }
}
