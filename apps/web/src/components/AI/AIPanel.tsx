import React, { useState, useEffect, useRef } from 'react';
import {
  AIProvider,
  AIModel,
  AIUsage,
  AIStreamEvent,
} from '@minfy/shared';
import { api } from '../../api/client.js';
import {
  Sparkles,
  RefreshCw,
  Send,
  Square,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Zap,
  Terminal,
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  usage?: AIUsage;
  isStreaming?: boolean;
}

export const AIPanel: React.FC = () => {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('ollama');
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loadingProviders, setLoadingProviders] = useState<boolean>(false);
  const [prompt, setPrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const activeProvider = providers.find((p) => p.id === selectedProvider);
  const isAvailable = activeProvider?.status === 'available';

  // Load providers on mount
  const loadProviders = async () => {
    try {
      setLoadingProviders(true);
      const res = await api.listAIProviders();
      setProviders(res.providers);

      const defaultProv = res.providers[0]?.id || 'ollama';
      setSelectedProvider(defaultProv);

      // Load models for provider
      await loadModels(defaultProv);
    } catch {
      // Ignore network failure
    } finally {
      setLoadingProviders(false);
    }
  };

  const loadModels = async (providerId: string) => {
    try {
      const res = await api.listAIModels(providerId);
      setModels(res.models);

      // Restore saved model or default to first
      const savedModel = localStorage.getItem(`minfy_ai_model_${providerId}`);
      if (savedModel && res.models.some((m) => m.id === savedModel)) {
        setSelectedModel(savedModel);
      } else if (res.models.length > 0) {
        setSelectedModel(res.models[0].id);
      } else {
        setSelectedModel('');
      }
    } catch {
      setModels([]);
      setSelectedModel('');
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    if (selectedProvider) {
      localStorage.setItem(`minfy_ai_model_${selectedProvider}`, modelId);
    }
  };

  const handleSendPrompt = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || !selectedModel || isGenerating) return;

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `asst-${Date.now()}`;

    const newMessages: Message[] = [
      ...messages,
      { id: userMsgId, role: 'user', content: trimmed },
      { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true },
    ];

    setMessages(newMessages);
    setPrompt('');
    setIsGenerating(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      await api.streamAIGenerate(
        {
          providerId: selectedProvider,
          modelId: selectedModel,
          prompt: trimmed,
        },
        (event: AIStreamEvent) => {
          if (event.type === 'text-delta' && event.textDelta) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: m.content + event.textDelta } : m
              )
            );
          } else if (event.type === 'usage' && event.usage) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, usage: event.usage, isStreaming: false }
                  : m
              )
            );
          } else if (event.type === 'completed') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, isStreaming: false, usage: event.usage || m.usage }
                  : m
              )
            );
          } else if (event.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      isStreaming: false,
                      usage: event.usage || m.usage,
                      content:
                        m.content ||
                        (event.error?.includes('stopped')
                          ? '_[Generation stopped by user]_'
                          : `⚠️ ${event.error || 'AI request failed'}`),
                    }
                  : m
              )
            );
          }
        },
        controller.signal
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  content: m.content || `⚠️ Error: ${err.message}`,
                }
              : m
          )
        );
      }
    } finally {
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  const handleStop = () => {
    if (abortController) {
      abortController.abort();
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSendPrompt();
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div
      style={{
        width: 'var(--sidebar-width)',
        backgroundColor: 'var(--surface-2)',
        borderRight: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={13} color="var(--minfy-yellow-accent)" />
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              color: 'var(--text-muted)',
            }}
          >
            AI Assistant
          </span>
        </div>

        <button
          onClick={loadProviders}
          title="Refresh AI Provider Status"
          style={{ padding: '3px', borderRadius: '3px', color: 'var(--text-muted)' }}
        >
          <RefreshCw size={13} className={loadingProviders ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Provider & Local Privacy Bar */}
      <div
        style={{
          padding: '8px 12px',
          backgroundColor: 'var(--surface-1)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {/* Provider Status Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <Cpu size={13} color="var(--minfy-blue-primary)" />
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              {activeProvider?.name || 'Ollama'}
            </span>
            <span
              style={{
                fontSize: '11px',
                color: isAvailable ? 'var(--success)' : 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '3px',
                  backgroundColor: isAvailable ? 'var(--success)' : 'var(--danger)',
                }}
              />
              {isAvailable ? 'Available' : 'Offline'}
            </span>
          </div>

          <span
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '8px',
              backgroundColor: 'var(--surface-3)',
              color: 'var(--minfy-yellow-accent)',
              fontWeight: 600,
            }}
          >
            Local • ₹0 Cost
          </span>
        </div>

        {/* Model Selector Row */}
        {isAvailable && models.length > 0 && (
          <div style={{ marginTop: '2px' }}>
            <select
              value={selectedModel}
              onChange={(e) => handleSelectModel(e.target.value)}
              disabled={isGenerating}
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: '12px',
                borderRadius: '4px',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                outline: 'none',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
              }}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Conversation & Response Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {!isAvailable ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <AlertCircle size={28} color="var(--warning)" />
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Ollama is Offline
            </div>
            <span>
              Ollama is not running on this machine. Start Ollama to use local AI models.
            </span>
            <div
              style={{
                backgroundColor: 'var(--surface-1)',
                padding: '6px 10px',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--minfy-yellow-accent)',
              }}
            >
              ollama serve
            </div>
          </div>
        ) : models.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <Terminal size={28} color="var(--info)" />
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              No Local Models Installed
            </div>
            <span>
              Ollama is running, but no models are installed yet.
            </span>
            <div
              style={{
                backgroundColor: 'var(--surface-1)',
                padding: '6px 10px',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--minfy-yellow-accent)',
              }}
            >
              ollama pull llama3
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div
            style={{
              padding: '32px 12px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Zap size={24} color="var(--minfy-yellow-accent)" />
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Ask Minfy
            </div>
            <span>Your local AI provider is ready. Enter a question or task below.</span>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '96%',
              }}
            >
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: msg.role === 'user' ? 'var(--minfy-blue-primary)' : 'var(--minfy-yellow-accent)',
                }}
              >
                {msg.role === 'user' ? 'You' : 'Minfy AI'}
              </div>

              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: msg.role === 'user' ? 'rgba(37, 99, 235, 0.15)' : 'var(--surface-1)',
                  border: msg.role === 'user' ? '1px solid rgba(37, 99, 235, 0.3)' : '1px solid var(--border-subtle)',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: msg.content.startsWith('```') ? 'var(--font-mono)' : 'inherit',
                }}
              >
                {msg.content}
                {msg.isStreaming && (
                  <span className="animate-pulse" style={{ color: 'var(--minfy-yellow-accent)' }}>
                    ▊
                  </span>
                )}
              </div>

              {msg.usage && (
                <div
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-disabled)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '2px',
                  }}
                >
                  <CheckCircle2 size={10} color="var(--success)" />
                  <span>{(msg.usage.durationMs / 1000).toFixed(1)}s</span>
                  {msg.usage.outputTokenCount !== undefined && (
                    <span>• {msg.usage.outputTokenCount} tokens</span>
                  )}
                  <span>• {msg.usage.costDescription}</span>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Prompt Input Area */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--surface-1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !isAvailable
              ? 'Ollama offline...'
              : models.length === 0
              ? 'No models installed...'
              : 'Ask a question (Ctrl+Enter to send)...'
          }
          disabled={!isAvailable || models.length === 0 || isGenerating}
          rows={3}
          style={{
            width: '100%',
            padding: '8px 10px',
            fontSize: '12px',
            borderRadius: '6px',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>
            Ctrl+Enter to send
          </span>

          {isGenerating ? (
            <button
              onClick={handleStop}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '4px',
                backgroundColor: 'rgba(248, 81, 73, 0.2)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Square size={12} fill="var(--danger)" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={handleSendPrompt}
              disabled={!isAvailable || models.length === 0 || !prompt.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '4px',
                backgroundColor:
                  !isAvailable || models.length === 0 || !prompt.trim()
                    ? 'var(--surface-3)'
                    : 'var(--minfy-blue-primary)',
                border: 'none',
                color:
                  !isAvailable || models.length === 0 || !prompt.trim()
                    ? 'var(--text-disabled)'
                    : '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor:
                  !isAvailable || models.length === 0 || !prompt.trim()
                    ? 'not-allowed'
                    : 'pointer',
              }}
            >
              <Send size={12} />
              <span>Send</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
