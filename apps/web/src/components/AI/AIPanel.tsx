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
  Cloud,
  Key,
  LogOut,
  ShieldCheck,
  Settings2,
} from 'lucide-react';
import { ProviderManagerModal } from './ProviderManagerModal.js';
import { BedrockConfigModal } from './BedrockConfigModal.js';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  usage?: AIUsage;
  isStreaming?: boolean;
}

export function mergeCodexStatus(
  providerList: AIProvider[],
  codexStatus: {
    connected: boolean;
    status: any;
    reason?: string;
    statusReason?: string;
    planType?: string;
  }
): AIProvider[] {
  return providerList.map((p) =>
    p.id === 'codex'
      ? {
          ...p,
          connected: codexStatus.connected,
          status: codexStatus.status,
          statusReason: codexStatus.reason || codexStatus.statusReason,
          planType: codexStatus.planType,
        }
      : p
  );
}

export const AIPanel: React.FC = () => {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [credentialBackendName, setCredentialBackendName] = useState<string>('Windows Credential Manager');
  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    return localStorage.getItem('minfy_ai_provider') || 'ollama';
  });
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loadingProviders, setLoadingProviders] = useState<boolean>(false);
  const [prompt, setPrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Connection form state for remote providers (OpenRouter)
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isManagerOpen, setIsManagerOpen] = useState<boolean>(false);
  const [isBedrockModalOpen, setIsBedrockModalOpen] = useState<boolean>(false);
  const [isCodexLoggingIn, setIsCodexLoggingIn] = useState<boolean>(false);

  const activeProvider = providers.find((p) => p.id === selectedProvider);
  const isBedrock = activeProvider?.id === 'bedrock';
  const isCodex = activeProvider?.id === 'codex';
  const requiresAuth = activeProvider?.requiresAuth ?? false;
  const isConnected = isBedrock
    ? (activeProvider?.connected ?? false)
    : isCodex
    ? (activeProvider?.connected ?? false)
    : requiresAuth
    ? (activeProvider?.connected ?? false)
    : true;
  const isAvailable = isBedrock
    ? (activeProvider?.connected ?? false) && activeProvider?.status === 'available'
    : isCodex
    ? (activeProvider?.connected ?? false) && activeProvider?.status === 'available'
    : (activeProvider?.status === 'available' || isConnected);

  const currentModel = models.find((m) => m.id === selectedModel);
  const isLocalExecution = currentModel ? currentModel.executionLocation === 'local' : selectedProvider === 'ollama';
  const isFreeModel = currentModel ? currentModel.billingType === 'free' : false;

  // Helper to resolve truthful Codex status and merge into a provided or current provider list
  const resolveCodexStatus = async (baseProviders?: AIProvider[]) => {
    try {
      const statusRes = await api.getCodexStatus();
      if (baseProviders) {
        const enriched = mergeCodexStatus(baseProviders, statusRes);
        setProviders(enriched);
      } else {
        setProviders((prev) => mergeCodexStatus(prev, statusRes));
      }
      return statusRes;
    } catch (err) {
      console.warn('Failed to resolve Codex status:', err);
      return null;
    }
  };

  // Load / refresh providers
  // options.targetProviderId: explicitly switch selection if desired (e.g. creating a new provider)
  // options.preserveSelection: when true, keep current selectedProvider intact without overriding
  const loadProviders = async (options?: { targetProviderId?: string; preserveSelection?: boolean }) => {
    try {
      setLoadingProviders(true);
      const res = await api.listAIProviders();
      const currentProviders = res.providers;

      // 1. Immediately establish provider list in state before any async provider-specific enrichment
      setProviders(currentProviders);

      if (res.credentialBackendName) {
        setCredentialBackendName(res.credentialBackendName);
      }

      // Determine the active selection
      let activeProvId = selectedProvider;
      if (options?.targetProviderId) {
        activeProvId = options.targetProviderId;
      } else if (!options?.preserveSelection) {
        // Bootstrap mode: resolve valid provider from stored value or default
        const stored = localStorage.getItem('minfy_ai_provider') || selectedProvider;
        activeProvId = currentProviders.some((p) => p.id === stored)
          ? stored
          : currentProviders[0]?.id || 'ollama';
      }

      // Validate provider exists in list
      const validProv = currentProviders.some((p) => p.id === activeProvId)
        ? activeProvId
        : currentProviders[0]?.id || 'ollama';

      setSelectedProvider(validProv);
      localStorage.setItem('minfy_ai_provider', validProv);

      // If the selected provider is Codex, enrich with live App Server status
      if (validProv === 'codex') {
        const result = await resolveCodexStatus(currentProviders);
        if (result?.connected) {
          await loadModels('codex');
        } else {
          setModels([]);
          setSelectedModel('');
        }
      } else {
        await loadModels(validProv);
      }
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

  const handleSelectProvider = async (providerId: string) => {
    setSelectedProvider(providerId);
    localStorage.setItem('minfy_ai_provider', providerId);
    setConnectError(null);
    setApiKeyInput('');

    if (providerId === 'codex') {
      const codexStatus = await resolveCodexStatus();
      if (codexStatus?.connected) {
        await loadModels('codex');
      } else {
        setModels([]);
        setSelectedModel('');
      }
    } else {
      await loadModels(providerId);
    }
  };

  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    if (selectedProvider) {
      localStorage.setItem(`minfy_ai_model_${selectedProvider}`, modelId);
    }
  };

  const handleConnectProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = apiKeyInput.trim();
    if (!trimmedKey) return;

    try {
      setIsConnecting(true);
      setConnectError(null);
      await api.connectAIProvider(selectedProvider, trimmedKey);
      setApiKeyInput('');
      await loadProviders({ targetProviderId: selectedProvider });
    } catch (err: any) {
      setConnectError(err.message || 'Connection failed. Please check your API key.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectProvider = async () => {
    try {
      await api.disconnectAIProvider(selectedProvider);
      await loadProviders({ targetProviderId: selectedProvider });
    } catch (err: any) {
      console.warn('Disconnect error:', err);
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

  const handleCodexLogin = async () => {
    try {
      setIsCodexLoggingIn(true);
      const res = await api.startCodexLogin();
      if (res.authUrl) {
        window.open(res.authUrl, '_blank');
      }

      const startTime = Date.now();
      const interval = setInterval(async () => {
        try {
          if (Date.now() - startTime > 5 * 60 * 1000) {
            clearInterval(interval);
            setIsCodexLoggingIn(false);
            return;
          }
          const status = await api.getCodexLoginStatus(res.loginId);
          if (status.status === 'completed') {
            clearInterval(interval);
            setIsCodexLoggingIn(false);
            await loadProviders({ preserveSelection: true });
          } else if (status.status === 'failed') {
            clearInterval(interval);
            setIsCodexLoggingIn(false);
          }
        } catch {
          clearInterval(interval);
          setIsCodexLoggingIn(false);
        }
      }, 2000);
    } catch {
      setIsCodexLoggingIn(false);
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
          onClick={() => loadProviders({ preserveSelection: true })}
          title="Refresh AI Provider Status"
          style={{ padding: '3px', borderRadius: '3px', color: 'var(--text-muted)' }}
        >
          <RefreshCw size={13} className={loadingProviders ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Provider Selector & Status Bar */}
      <div
        style={{
          padding: '8px 12px',
          backgroundColor: 'var(--surface-1)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* Provider Switcher Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
            {selectedProvider === 'openrouter' ? (
              <Cloud size={14} color="var(--info)" />
            ) : (
              <Cpu size={14} color="var(--minfy-blue-primary)" />
            )}
            <select
              value={selectedProvider}
              onChange={(e) => handleSelectProvider(e.target.value)}
              disabled={isGenerating}
              style={{
                flex: 1,
                padding: '3px 6px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '4px',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.source === 'custom' ? '(Custom)' : p.type === 'local' ? '(Local)' : '(Remote)'}
                </option>
              ))}
            </select>

            <button
              onClick={() => setIsManagerOpen(true)}
              title="Manage AI Providers"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 7px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '4px',
                backgroundColor: 'var(--surface-3)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Settings2 size={12} />
              <span>Manage</span>
            </button>
          </div>

          {/* Connected / Available Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {isBedrock ? (
              <button
                onClick={() => setIsBedrockModalOpen(true)}
                title="Configure Bedrock Region & Profile"
                style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: isConnected ? 'rgba(255, 153, 0, 0.15)' : 'rgba(248, 81, 73, 0.1)',
                  border: '1px solid ' + (isConnected ? 'rgba(255, 153, 0, 0.3)' : 'var(--border-subtle)'),
                  color: isConnected ? '#ff9900' : 'var(--text-disabled)',
                  fontSize: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                }}
              >
                <Cloud size={10} />
                <span>{isConnected ? activeProvider?.region || 'AWS' : 'Configure AWS'}</span>
              </button>
            ) : requiresAuth ? (
              isConnected ? (
                <button
                  onClick={handleDisconnectProvider}
                  title="Disconnect Provider API Key"
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(248, 81, 73, 0.1)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    fontSize: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <LogOut size={10} />
                  <span>Disconnect</span>
                </button>
              ) : (
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-disabled)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  ○ Not Connected
                </span>
              )
            ) : (
              <span
                style={{
                  fontSize: '10px',
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
            )}
          </div>
        </div>

        {/* Model Selector Row (when connected/available) */}
        {isConnected && isAvailable && models.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Model
              </span>
              {/* Cost/Location Pill */}
              <span
                style={{
                  fontSize: '10px',
                  padding: '1px 5px',
                  borderRadius: '6px',
                  backgroundColor: isFreeModel
                    ? 'rgba(63, 185, 80, 0.15)'
                    : isBedrock
                    ? 'rgba(255, 153, 0, 0.15)'
                    : isLocalExecution
                    ? 'var(--surface-3)'
                    : 'rgba(88, 166, 255, 0.15)',
                  color: isFreeModel
                    ? 'var(--success)'
                    : isBedrock
                    ? '#ff9900'
                    : isLocalExecution
                    ? 'var(--minfy-yellow-accent)'
                    : 'var(--info)',
                  fontWeight: 600,
                }}
              >
                {isFreeModel ? 'Free • Remote' : isBedrock ? 'Metered • AWS' : isLocalExecution ? 'Local • ₹0 Cost' : 'Cloud Router'}
              </span>
            </div>

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
                  {m.displayName} {m.billingType === 'free' ? '🎁 [Free]' : m.executionLocation === 'cloud' ? '☁ [Cloud]' : '💻 [Local]'}
                </option>
              ))}
            </select>

            {/* Subtitle describing inference location and billing semantics */}
            <div
              style={{
                fontSize: '10px',
                color: isFreeModel ? 'var(--success)' : !isLocalExecution ? 'var(--info)' : 'var(--text-muted)',
                marginTop: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {isCodex ? (
                <>
                  <Cloud size={10} color="#a6e3a1" />
                  <span>Codex • ChatGPT account • Account usage limits apply</span>
                </>
              ) : isBedrock ? (
                <>
                  <Cloud size={10} color="#ff9900" />
                  <span>AWS Bedrock • Remote inference • AWS-billed usage</span>
                </>
              ) : isFreeModel ? (
                <>
                  <Sparkles size={10} color="var(--success)" />
                  <span>OpenRouter Free • Remote inference • Free token pricing</span>
                </>
              ) : !isLocalExecution ? (
                <>
                  <Cloud size={10} />
                  <span>Remote inference via {activeProvider?.name} • Provider quota applies</span>
                </>
              ) : (
                <>
                  <Zap size={10} color="var(--minfy-yellow-accent)" />
                  <span>Local AI • Runs on this machine • No metered API charge</span>
                </>
              )}
            </div>
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
        {isCodex && !isConnected ? (
          /* Codex Setup Card */
          <div
            style={{
              padding: '16px 12px',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={18} color="#a6e3a1" />
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                Sign in to Codex with ChatGPT
              </div>
            </div>

            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              Minfy connects to OpenAI Codex via the local Codex App Server and your ChatGPT account. No API keys or OAuth tokens are stored in Minfy.
            </span>

            {activeProvider?.statusReason && (
              <div
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'rgba(248, 81, 73, 0.1)',
                  borderRadius: '4px',
                  border: '1px solid rgba(248, 81, 73, 0.2)',
                  color: 'var(--danger)',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{activeProvider.statusReason}</span>
              </div>
            )}

            <button
              onClick={handleCodexLogin}
              disabled={isCodexLoggingIn}
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(166, 227, 161, 0.15)',
                border: '1px solid rgba(166, 227, 161, 0.4)',
                borderRadius: '4px',
                color: '#a6e3a1',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <span>{isCodexLoggingIn ? 'Waiting for browser sign-in…' : 'Sign in with ChatGPT'}</span>
            </button>
          </div>
        ) : isBedrock && !isConnected ? (
          /* Bedrock Setup Card */
          <div
            style={{
              padding: '16px 12px',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cloud size={18} color="#ff9900" />
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                Configure AWS Bedrock
              </div>
            </div>

            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              Minfy connects to AWS Bedrock via your local AWS SDK credential chain (SSO, IAM Identity Center, environment, or named profiles). No AWS secrets are stored.
            </span>

            {activeProvider?.statusReason && (
              <div
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'rgba(248, 81, 73, 0.1)',
                  borderRadius: '4px',
                  border: '1px solid rgba(248, 81, 73, 0.2)',
                  color: 'var(--danger)',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{activeProvider.statusReason}</span>
              </div>
            )}

            <button
              onClick={() => setIsBedrockModalOpen(true)}
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(255, 153, 0, 0.15)',
                border: '1px solid rgba(255, 153, 0, 0.4)',
                borderRadius: '4px',
                color: '#ff9900',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Settings2 size={14} />
              <span>Configure AWS Region & Profile</span>
            </button>
          </div>
        ) : requiresAuth && !isConnected ? (
          /* Connect Provider Card */
          <div
            style={{
              padding: '16px 12px',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Key size={18} color="var(--info)" />
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                Connect {activeProvider?.name || 'Provider'}
              </div>
            </div>

            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              {activeProvider?.id === 'openrouter'
                ? 'Enter your OpenRouter API key to access remote models, including OpenRouter Free models.'
                : `Enter your API key or Bearer token for ${activeProvider?.name} to connect.`}
            </span>

            <form onSubmit={handleConnectProvider} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={activeProvider?.id === 'openrouter' ? 'sk-or-v1-...' : 'Enter API key or Bearer token...'}
                disabled={isConnecting}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  fontFamily: 'var(--font-mono)',
                }}
              />

              {connectError && (
                <span style={{ fontSize: '11px', color: 'var(--danger)' }}>
                  {connectError}
                </span>
              )}

              <button
                type="submit"
                disabled={isConnecting || !apiKeyInput.trim()}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  backgroundColor: isConnecting || !apiKeyInput.trim() ? 'var(--surface-3)' : 'var(--minfy-blue-primary)',
                  color: isConnecting || !apiKeyInput.trim() ? 'var(--text-disabled)' : '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: isConnecting || !apiKeyInput.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                {isConnecting ? 'Verifying...' : 'Connect'}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-disabled)' }}>
              <ShieldCheck size={12} color="var(--success)" />
              <span>Credentials secured by {credentialBackendName || 'OS Keyring'}</span>
            </div>
          </div>
        ) : !isAvailable && selectedProvider === 'ollama' ? (
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
              Ollama is not running on this machine. Start Ollama or switch to OpenRouter above.
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
              No Models Discovered
            </div>
            <span>
              {selectedProvider === 'ollama'
                ? 'Ollama is running, but no local models are installed yet.'
                : 'No models discovered for OpenRouter.'}
            </span>
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
            <span>
              {isFreeModel
                ? 'OpenRouter Free model ready for remote inference.'
                : !isLocalExecution
                ? 'Remote AI provider ready. Enter a question or task below.'
                : 'Your local AI provider is ready. Enter a question or task below.'}
            </span>
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
                    flexWrap: 'wrap',
                  }}
                >
                  <CheckCircle2 size={10} color="var(--success)" />
                  <span>{(msg.usage.durationMs / 1000).toFixed(1)}s</span>
                  {msg.usage.outputTokenCount !== undefined && (
                    <span>• {msg.usage.outputTokenCount} tokens</span>
                  )}
                  <span>• {msg.usage.costDescription || (msg.usage.billingType === 'free' ? 'Free token pricing' : msg.usage.executionLocation === 'local' ? 'Local • ₹0 API cost' : 'Remote inference')}</span>
                  {msg.usage.resolvedModelId && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      (routed to {msg.usage.resolvedModelId})
                    </span>
                  )}
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
            requiresAuth && !isConnected
              ? 'Connect provider to start...'
              : !isAvailable
              ? 'Provider offline...'
              : models.length === 0
              ? 'No models available...'
              : 'Ask a question (Ctrl+Enter to send)...'
          }
          disabled={!isConnected || !isAvailable || models.length === 0 || isGenerating}
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
              disabled={!isConnected || !isAvailable || models.length === 0 || !prompt.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '4px',
                backgroundColor:
                  !isConnected || !isAvailable || models.length === 0 || !prompt.trim()
                    ? 'var(--surface-3)'
                    : 'var(--minfy-blue-primary)',
                border: 'none',
                color:
                  !isConnected || !isAvailable || models.length === 0 || !prompt.trim()
                    ? 'var(--text-disabled)'
                    : '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor:
                  !isConnected || !isAvailable || models.length === 0 || !prompt.trim()
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

      <ProviderManagerModal
        isOpen={isManagerOpen}
        onClose={() => setIsManagerOpen(false)}
        providers={providers}
        onRefresh={loadProviders}
      />

      <BedrockConfigModal
        isOpen={isBedrockModalOpen}
        onClose={() => setIsBedrockModalOpen(false)}
        onSaveSuccess={async () => {
          await loadProviders({ targetProviderId: 'bedrock' });
        }}
      />
    </div>
  );
};
