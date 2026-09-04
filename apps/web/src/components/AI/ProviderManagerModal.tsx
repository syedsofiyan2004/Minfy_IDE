import React, { useState, useEffect } from 'react';
import {
  AIProvider,
  ProviderManifest,
  AIExecutionLocation,
  AIBillingType,
} from '@minfy/shared';
import { api } from '../../api/client.js';
import {
  X,
  Plus,
  Trash2,
  Edit2,
  AlertCircle,
  Shield,
  Layers,
  Settings2,
} from 'lucide-react';
import { BedrockConfigModal } from './BedrockConfigModal.js';

interface ProviderManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  providers: AIProvider[];
  onRefresh: (targetProviderId?: string) => Promise<void>;
}

export const ProviderManagerModal: React.FC<ProviderManagerModalProps> = ({
  isOpen,
  onClose,
  providers,
  onRefresh,
}) => {
  const [manifests, setManifests] = useState<ProviderManifest[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [view, setView] = useState<'list' | 'add' | 'edit'>('list');
  const [editingManifest, setEditingManifest] = useState<ProviderManifest | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isBedrockModalOpen, setIsBedrockModalOpen] = useState<boolean>(false);
  const [codexLoggingIn, setCodexLoggingIn] = useState<boolean>(false);

  // Form fields
  const [name, setName] = useState<string>('');
  const [id, setId] = useState<string>('');
  const [idManuallyEdited, setIdManuallyEdited] = useState<boolean>(false);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [authType, setAuthType] = useState<'none' | 'bearer'>('none');
  const [enabled, setEnabled] = useState<boolean>(true);
  const [executionLocation, setExecutionLocation] = useState<AIExecutionLocation>('unknown');
  const [billingType, setBillingType] = useState<AIBillingType>('unknown');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const loadManifests = async () => {
    try {
      setLoading(true);
      const res = await api.listProviderManifests();
      setManifests(res.manifests);
    } catch (err: any) {
      console.warn('Failed to load manifests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadManifests();
      setView('list');
      setDeletingId(null);
      setFormError(null);
      api.getCodexStatus()
        .then(() => onRefresh('codex'))
        .catch(() => {});
    }
  }, [isOpen]);

  const slugify = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!idManuallyEdited && view === 'add') {
      setId(slugify(val));
    }
  };

  const handleOpenAdd = () => {
    setName('');
    setId('');
    setIdManuallyEdited(false);
    setBaseUrl('');
    setAuthType('none');
    setEnabled(true);
    setExecutionLocation('unknown');
    setBillingType('unknown');
    setShowAdvanced(false);
    setFormError(null);
    setView('add');
  };

  const handleOpenEdit = (m: ProviderManifest) => {
    setEditingManifest(m);
    setName(m.name);
    setId(m.id);
    setBaseUrl(m.baseUrl);
    setAuthType(m.auth.type);
    setEnabled(m.enabled !== false);
    setExecutionLocation(m.defaults?.executionLocation || 'unknown');
    setBillingType(m.defaults?.billingType || 'unknown');
    setShowAdvanced(Boolean(m.defaults && (m.defaults.executionLocation !== 'unknown' || m.defaults.billingType !== 'unknown')));
    setFormError(null);
    setView('edit');
  };

  const handleToggleEnabled = async (m: ProviderManifest) => {
    const newEnabled = m.enabled === false;
    try {
      setIsSubmitting(true);
      setFormError(null);
      await api.updateProviderManifest(m.id, {
        ...m,
        enabled: newEnabled,
      });
      await loadManifests();
      await onRefresh();
    } catch (err: any) {
      setFormError(err.message || 'Failed to toggle provider state.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = name.trim();
    const cleanId = id.trim().toLowerCase();
    const cleanBaseUrl = baseUrl.trim();

    if (!cleanName) {
      setFormError('Provider name is required.');
      return;
    }
    if (!cleanId) {
      setFormError('Provider ID is required.');
      return;
    }
    if (!cleanBaseUrl) {
      setFormError('Base URL is required.');
      return;
    }

    const payload: Partial<ProviderManifest> = {
      schemaVersion: 1,
      id: cleanId,
      name: cleanName,
      protocol: 'openai-compatible',
      providerType: 'api',
      baseUrl: cleanBaseUrl,
      auth: {
        type: authType,
        required: authType === 'bearer',
      },
      defaults: {
        executionLocation,
        billingType,
      },
      enabled,
    };

    try {
      setIsSubmitting(true);
      if (view === 'add') {
        await api.createProviderManifest(payload);
      } else if (view === 'edit' && editingManifest) {
        await api.updateProviderManifest(editingManifest.id, payload);
      }

      await loadManifests();
      await onRefresh(enabled ? cleanId : undefined);
      setView('list');
    } catch (err: any) {
      setFormError(err.message || 'Failed to save provider.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async (targetId: string) => {
    try {
      setIsSubmitting(true);
      await api.deleteProviderManifest(targetId);
      setDeletingId(null);
      await loadManifests();
      await onRefresh();
    } catch (err: any) {
      setFormError(err.message || 'Failed to delete provider.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const builtInProviders = providers.filter((p) => p.source === 'built-in' || p.id === 'ollama' || p.id === 'openrouter');
  const customProviders = providers.filter((p) => !builtInProviders.some((bp) => bp.id === p.id));

  const handleCodexLogin = async () => {
    try {
      setCodexLoggingIn(true);
      const res = await api.startCodexLogin();
      if (res.authUrl) {
        window.open(res.authUrl, '_blank');
      }

      const startTime = Date.now();
      const interval = setInterval(async () => {
        try {
          if (Date.now() - startTime > 5 * 60 * 1000) {
            clearInterval(interval);
            setCodexLoggingIn(false);
            return;
          }
          const status = await api.getCodexLoginStatus(res.loginId);
          if (status.status === 'completed') {
            clearInterval(interval);
            setCodexLoggingIn(false);
            await onRefresh('codex');
          } else if (status.status === 'failed') {
            clearInterval(interval);
            setCodexLoggingIn(false);
          }
        } catch {
          clearInterval(interval);
          setCodexLoggingIn(false);
        }
      }, 2000);
    } catch {
      setCodexLoggingIn(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-[#181825] border border-[#313244] rounded-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#313244] bg-[#11111b]">
          <div className="flex items-center gap-2.5">
            <Settings2 className="w-5 h-5 text-[#89b4fa]" />
            <h2 className="text-base font-semibold text-[#cdd6f4]">
              AI Provider Manager
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244] rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {view === 'list' && (
            <div className="space-y-6">
              {/* Built-in Section */}
              <div>
                <div className="text-xs font-semibold text-[#a6adc8] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#89b4fa]" />
                  Built-in Providers
                </div>
                <div className="space-y-2">
                  {builtInProviders.map((prov) => {
                    const isBedrock = prov.id === 'bedrock';
                    const isCodex = prov.id === 'codex';
                    const description = isCodex
                      ? prov.connected
                        ? `Signed in with ChatGPT${prov.planType ? ` (${prov.planType.toUpperCase()})` : ''} • Account limits apply`
                        : prov.statusReason || 'Sign in with ChatGPT required'
                      : isBedrock
                      ? prov.connected
                        ? `Connected via AWS SDK (${prov.region || 'Region configured'})`
                        : prov.statusReason || 'AWS Region required'
                      : prov.requiresAuth
                      ? prov.connected
                        ? 'Connected via CredentialStore'
                        : 'API key required'
                      : prov.status === 'available'
                      ? 'Local service detected'
                      : 'Offline / unreachable';

                    return (
                      <div
                        key={prov.id}
                        className="flex items-center justify-between p-3 bg-[#1e1e2e] border border-[#313244] rounded-md"
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${
                              prov.status === 'available'
                                ? 'bg-[#a6e3a1]'
                                : prov.connected
                                ? 'bg-[#89b4fa]'
                                : 'bg-[#f38ba8]'
                            }`}
                          />
                          <div>
                            <div className="text-sm font-medium text-[#cdd6f4] flex items-center gap-2">
                              {prov.name}
                              <span className="text-[10px] bg-[#313244] text-[#bac2de] px-1.5 py-0.5 rounded font-mono">
                                built-in
                              </span>
                            </div>
                            <div className="text-xs text-[#6c7086]">
                              {description}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-xs text-[#a6adc8]">
                            {prov.modelsCount ? `${prov.modelsCount} models` : '0 models'}
                          </div>
                          {isBedrock && (
                            <button
                              onClick={() => setIsBedrockModalOpen(true)}
                              className="px-2 py-0.5 text-[11px] font-medium text-[#89b4fa] bg-[#89b4fa]/10 hover:bg-[#89b4fa]/20 border border-[#89b4fa]/30 rounded transition-colors"
                            >
                              Configure
                            </button>
                          )}
                          {isCodex && !prov.connected && (
                            <button
                              onClick={() => handleCodexLogin()}
                              disabled={codexLoggingIn}
                              className="px-2.5 py-1 text-[11px] font-medium text-[#a6e3a1] bg-[#a6e3a1]/10 hover:bg-[#a6e3a1]/20 border border-[#a6e3a1]/30 rounded transition-colors"
                            >
                              {codexLoggingIn ? 'Waiting...' : 'Sign in with ChatGPT'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Custom Providers Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#a6adc8] uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#f9e2af]" />
                    Custom Providers ({manifests.length})
                  </div>
                  <button
                    onClick={handleOpenAdd}
                    className="flex items-center gap-1 text-xs text-[#89b4fa] hover:text-[#b4befe] font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Provider
                  </button>
                </div>

                {loading ? (
                  <div className="text-center py-6 text-xs text-[#6c7086]">
                    Loading provider manifests...
                  </div>
                ) : manifests.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-[#313244] rounded-md text-xs text-[#6c7086]">
                    No custom OpenAI-compatible providers configured.
                    <div className="mt-2">
                      <button
                        onClick={handleOpenAdd}
                        className="text-[#89b4fa] hover:underline"
                      >
                        Add your first compatible endpoint
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {manifests.map((m) => {
                      const isDisabled = m.enabled === false;
                      const runtimeProv = customProviders.find((p) => p.id === m.id);
                      const isAvail = runtimeProv?.status === 'available';
                      const isConn = runtimeProv?.connected;

                      return (
                        <div
                          key={m.id}
                          className={`flex items-center justify-between p-3 border rounded-md transition-colors ${
                            isDisabled
                              ? 'bg-[#181825] border-[#313244]/60 opacity-75'
                              : 'bg-[#1e1e2e] border-[#313244]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-2.5 h-2.5 rounded-full ${
                                isDisabled
                                  ? 'bg-[#6c7086]'
                                  : isAvail
                                  ? 'bg-[#a6e3a1]'
                                  : isConn
                                  ? 'bg-[#89b4fa]'
                                  : 'bg-[#f38ba8]'
                              }`}
                            />
                            <div>
                              <div className="text-sm font-medium text-[#cdd6f4] flex items-center gap-2">
                                {m.name}
                                {isDisabled ? (
                                  <span className="text-[10px] bg-[#313244] text-[#6c7086] px-1.5 py-0.5 rounded font-mono">
                                    Disabled
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-[#313244] text-[#89b4fa] px-1.5 py-0.5 rounded font-mono">
                                    {m.auth.type === 'bearer' ? 'Bearer' : 'None'}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-[#6c7086] font-mono truncate max-w-[220px]">
                                {m.baseUrl}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleToggleEnabled(m)}
                              title={isDisabled ? 'Enable Provider' : 'Disable Provider'}
                              disabled={isSubmitting}
                              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                                isDisabled
                                  ? 'text-[#a6e3a1] bg-[#a6e3a1]/10 hover:bg-[#a6e3a1]/20 border border-[#a6e3a1]/30'
                                  : 'text-[#bac2de] bg-[#313244] hover:bg-[#45475a]'
                              }`}
                            >
                              {isDisabled ? 'Enable' : 'Disable'}
                            </button>

                            <button
                              onClick={() => handleOpenEdit(m)}
                              title="Edit Provider"
                              className="p-1.5 text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244] rounded transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setDeletingId(m.id)}
                              title="Remove Provider"
                              className="p-1.5 text-[#f38ba8] hover:bg-[#f38ba8]/10 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Delete Confirmation Modal */}
              {deletingId && (
                <div className="p-3 bg-[#f38ba8]/10 border border-[#f38ba8]/30 rounded-md mt-4">
                  <div className="text-xs text-[#f38ba8] font-medium mb-2">
                    Remove &quot;{manifests.find((m) => m.id === deletingId)?.name || deletingId}&quot;?
                  </div>
                  <p className="text-[11px] text-[#a6adc8] mb-3">
                    This removes the provider configuration and any stored credentials.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="px-2.5 py-1 text-xs text-[#cdd6f4] bg-[#313244] hover:bg-[#45475a] rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDeleteConfirm(deletingId)}
                      disabled={isSubmitting}
                      className="px-2.5 py-1 text-xs text-[#11111b] bg-[#f38ba8] hover:bg-[#eba0ac] font-medium rounded transition-colors"
                    >
                      {isSubmitting ? 'Removing...' : 'Remove Provider'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Add / Edit Form */}
          {(view === 'add' || view === 'edit') && (
            <form onSubmit={handleSaveProvider} className="space-y-4">
              {formError && (
                <div className="p-2.5 bg-[#f38ba8]/10 border border-[#f38ba8]/30 rounded text-xs text-[#f38ba8] flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#a6adc8] mb-1">
                  Provider Name <span className="text-[#f38ba8]">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Company AI Gateway, LM Studio"
                  required
                  className="w-full bg-[#1e1e2e] border border-[#313244] focus:border-[#89b4fa] rounded px-3 py-1.5 text-xs text-[#cdd6f4] placeholder-[#6c7086] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#a6adc8] mb-1">
                  Provider ID <span className="text-[#f38ba8]">*</span>
                </label>
                <input
                  type="text"
                  value={id}
                  disabled={view === 'edit'}
                  onChange={(e) => {
                    setId(e.target.value.toLowerCase());
                    setIdManuallyEdited(true);
                  }}
                  placeholder="e.g. company-ai"
                  required
                  className="w-full bg-[#1e1e2e] border border-[#313244] focus:border-[#89b4fa] disabled:opacity-60 rounded px-3 py-1.5 text-xs font-mono text-[#cdd6f4] placeholder-[#6c7086] outline-none"
                />
                <p className="text-[10px] text-[#6c7086] mt-0.5">
                  Lowercase alphanumeric with dots, underscores, or hyphens.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#a6adc8] mb-1">
                  Base URL <span className="text-[#f38ba8]">*</span>
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:1234/v1 or https://api.company.com/v1"
                  required
                  className="w-full bg-[#1e1e2e] border border-[#313244] focus:border-[#89b4fa] rounded px-3 py-1.5 text-xs font-mono text-[#cdd6f4] placeholder-[#6c7086] outline-none"
                />
                <p className="text-[10px] text-[#6c7086] mt-0.5">
                  Must be http: or https:. Relative endpoints (/models, /chat/completions) cannot escape this boundary.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#a6adc8] mb-1.5">
                  Authentication Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex items-center gap-2 p-2.5 rounded border cursor-pointer text-xs transition-colors ${
                    authType === 'none'
                      ? 'border-[#89b4fa] bg-[#89b4fa]/10 text-[#cdd6f4]'
                      : 'border-[#313244] bg-[#1e1e2e] text-[#a6adc8]'
                  }`}>
                    <input
                      type="radio"
                      name="authType"
                      checked={authType === 'none'}
                      onChange={() => setAuthType('none')}
                      className="hidden"
                    />
                    <div className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                      authType === 'none' ? 'border-[#89b4fa] bg-[#89b4fa]' : 'border-[#6c7086]'
                    }`}>
                      {authType === 'none' && <div className="w-1.5 h-1.5 bg-[#11111b] rounded-full" />}
                    </div>
                    <span>None (Local / Open)</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2.5 rounded border cursor-pointer text-xs transition-colors ${
                    authType === 'bearer'
                      ? 'border-[#89b4fa] bg-[#89b4fa]/10 text-[#cdd6f4]'
                      : 'border-[#313244] bg-[#1e1e2e] text-[#a6adc8]'
                  }`}>
                    <input
                      type="radio"
                      name="authType"
                      checked={authType === 'bearer'}
                      onChange={() => setAuthType('bearer')}
                      className="hidden"
                    />
                    <div className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                      authType === 'bearer' ? 'border-[#89b4fa] bg-[#89b4fa]' : 'border-[#6c7086]'
                    }`}>
                      {authType === 'bearer' && <div className="w-1.5 h-1.5 bg-[#11111b] rounded-full" />}
                    </div>
                    <span>API Key (Bearer)</span>
                  </label>
                </div>
                <p className="text-[10px] text-[#6c7086] mt-1">
                  {authType === 'bearer'
                    ? 'API key will be secured in Minfy CredentialStore. Never stored inside manifest file.'
                    : 'No credentials required. Connects directly to the endpoint.'}
                </p>
              </div>

              {/* Enabled checkbox */}
              <div className="pt-2">
                <label className="flex items-center gap-2 text-xs text-[#cdd6f4] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="rounded border-[#313244] bg-[#1e1e2e] text-[#89b4fa]"
                  />
                  <span>Enable this provider for active AI usage</span>
                </label>
                <p className="text-[10px] text-[#6c7086] ml-5">
                  Disabled providers remain saved on disk but are inactive and hidden from the editor picker.
                </p>
              </div>

              {/* Advanced semantic defaults */}
              <div className="pt-2 border-t border-[#313244]">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-[#89b4fa] hover:text-[#b4befe] flex items-center gap-1"
                >
                  {showAdvanced ? '▼ Hide Metadata Defaults' : '▶ Advanced Metadata Defaults (Optional)'}
                </button>

                {showAdvanced && (
                  <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-[#1e1e2e] rounded border border-[#313244]">
                    <div>
                      <label className="block text-[11px] font-medium text-[#a6adc8] mb-1">
                        Inference Location
                      </label>
                      <select
                        value={executionLocation}
                        onChange={(e) => setExecutionLocation(e.target.value as AIExecutionLocation)}
                        className="w-full bg-[#181825] border border-[#313244] rounded px-2 py-1 text-xs text-[#cdd6f4] outline-none"
                      >
                        <option value="unknown">Unknown</option>
                        <option value="local">Local</option>
                        <option value="cloud">Cloud</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#a6adc8] mb-1">
                        Billing Classification
                      </label>
                      <select
                        value={billingType}
                        onChange={(e) => setBillingType(e.target.value as AIBillingType)}
                        className="w-full bg-[#181825] border border-[#313244] rounded px-2 py-1 text-xs text-[#cdd6f4] outline-none"
                      >
                        <option value="unknown">Unknown</option>
                        <option value="local">Local (No charge)</option>
                        <option value="free">Free</option>
                        <option value="subscription">Subscription</option>
                        <option value="metered">Metered / Paid</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Form Buttons */}
              <div className="flex justify-end gap-2 pt-3 border-t border-[#313244]">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="px-3 py-1.5 text-xs text-[#cdd6f4] bg-[#313244] hover:bg-[#45475a] rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 text-xs text-[#11111b] bg-[#89b4fa] hover:bg-[#b4befe] font-semibold rounded transition-colors"
                >
                  {isSubmitting ? 'Saving...' : view === 'add' ? 'Save Provider' : 'Update Provider'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <BedrockConfigModal
        isOpen={isBedrockModalOpen}
        onClose={() => setIsBedrockModalOpen(false)}
        onSaveSuccess={async () => {
          await onRefresh();
        }}
      />
    </div>
  );
};
