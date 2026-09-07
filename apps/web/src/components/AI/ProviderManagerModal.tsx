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
  onRefresh: (options?: { targetProviderId?: string; preserveSelection?: boolean }) => Promise<void>;
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
        .then(() => onRefresh({ preserveSelection: true }))
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
      await onRefresh({ targetProviderId: enabled ? cleanId : undefined, preserveSelection: !enabled });
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
      await onRefresh({ preserveSelection: true });
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
            await onRefresh({ preserveSelection: true });
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Settings2 size={18} color="var(--info)" />
            <span>AI Provider Manager</span>
          </div>
          <button onClick={onClose} className="modal-close-btn" title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="modal-body">
          {view === 'list' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Built-in Section */}
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Shield size={13} color="var(--info)" />
                  <span>Built-in Providers</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                      <div key={prov.id} className="modal-card-item">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor:
                                prov.status === 'available'
                                  ? 'var(--success)'
                                  : prov.connected
                                  ? 'var(--info)'
                                  : 'var(--danger)',
                            }}
                          />
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{prov.name}</span>
                              <span
                                style={{
                                  fontSize: '10px',
                                  backgroundColor: 'var(--surface-3)',
                                  color: 'var(--text-muted)',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                built-in
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {description}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {prov.modelsCount ? `${prov.modelsCount} models` : '0 models'}
                          </div>
                          {isBedrock && (
                            <button
                              onClick={() => setIsBedrockModalOpen(true)}
                              className="modal-btn modal-btn-secondary"
                              style={{ padding: '3px 8px', fontSize: '11px' }}
                            >
                              Configure
                            </button>
                          )}
                          {isCodex && !prov.connected && (
                            <button
                              onClick={() => handleCodexLogin()}
                              disabled={codexLoggingIn}
                              className="modal-btn modal-btn-primary"
                              style={{ padding: '3px 10px', fontSize: '11px' }}
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Layers size={13} color="var(--minfy-yellow-accent)" />
                    <span>Custom Providers ({manifests.length})</span>
                  </div>
                  <button
                    onClick={handleOpenAdd}
                    className="modal-btn modal-btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                  >
                    <Plus size={12} />
                    <span>Add Provider</span>
                  </button>
                </div>

                {loading ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                    Loading provider manifests...
                  </div>
                ) : manifests.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '24px',
                      border: '1px dashed var(--border-default)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    No custom OpenAI-compatible providers configured.
                    <div style={{ marginTop: '8px' }}>
                      <button
                        onClick={handleOpenAdd}
                        style={{ color: 'var(--info)', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Add your first compatible endpoint
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {manifests.map((m) => {
                      const isDisabled = m.enabled === false;
                      const runtimeProv = customProviders.find((p) => p.id === m.id);
                      const isAvail = runtimeProv?.status === 'available';
                      const isConn = runtimeProv?.connected;

                      return (
                        <div
                          key={m.id}
                          className="modal-card-item"
                          style={{ opacity: isDisabled ? 0.7 : 1 }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: isDisabled
                                  ? 'var(--text-disabled)'
                                  : isAvail
                                  ? 'var(--success)'
                                  : isConn
                                  ? 'var(--info)'
                                  : 'var(--danger)',
                              }}
                            />
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>{m.name}</span>
                                {isDisabled ? (
                                  <span style={{ fontSize: '10px', backgroundColor: 'var(--surface-3)', color: 'var(--text-muted)', padding: '1px 5px', borderRadius: '3px' }}>
                                    Disabled
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '10px', backgroundColor: 'var(--surface-3)', color: 'var(--info)', padding: '1px 5px', borderRadius: '3px' }}>
                                    {m.auth.type === 'bearer' ? 'Bearer' : 'None'}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                                {m.baseUrl}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              onClick={() => handleToggleEnabled(m)}
                              title={isDisabled ? 'Enable Provider' : 'Disable Provider'}
                              disabled={isSubmitting}
                              className="modal-btn modal-btn-secondary"
                              style={{ padding: '3px 8px', fontSize: '11px' }}
                            >
                              {isDisabled ? 'Enable' : 'Disable'}
                            </button>

                            <button
                              onClick={() => handleOpenEdit(m)}
                              title="Edit Provider"
                              className="modal-close-btn"
                              style={{ padding: '5px' }}
                            >
                              <Edit2 size={13} />
                            </button>

                            <button
                              onClick={() => setDeletingId(m.id)}
                              title="Remove Provider"
                              className="modal-close-btn"
                              style={{ padding: '5px', color: 'var(--danger)' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Delete Confirmation Card */}
              {deletingId && (
                <div
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'rgba(248, 81, 73, 0.1)',
                    border: '1px solid rgba(248, 81, 73, 0.3)',
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--danger)', marginBottom: '4px' }}>
                    Remove &quot;{manifests.find((m) => m.id === deletingId)?.name || deletingId}&quot;?
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    This removes the provider configuration and any stored credentials.
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="modal-btn modal-btn-secondary"
                      style={{ padding: '3px 10px', fontSize: '11px' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDeleteConfirm(deletingId)}
                      disabled={isSubmitting}
                      className="modal-btn modal-btn-danger"
                      style={{ padding: '3px 10px', fontSize: '11px' }}
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
            <form onSubmit={handleSaveProvider} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {formError && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: 'rgba(248, 81, 73, 0.1)',
                    border: '1px solid rgba(248, 81, 73, 0.3)',
                    borderRadius: '6px',
                    color: 'var(--danger)',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Provider Name <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Company AI Gateway, LM Studio"
                  required
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Provider ID <span style={{ color: 'var(--danger)' }}>*</span>
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
                  style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                />
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Lowercase alphanumeric with dots, underscores, or hyphens.
                </p>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Base URL <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:1234/v1 or https://api.company.com/v1"
                  required
                  style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                />
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Must be http: or https:. Relative endpoints (/models, /chat/completions) cannot escape this boundary.
                </p>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Authentication Method
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid ' + (authType === 'none' ? 'var(--info)' : 'var(--border-default)'),
                      backgroundColor: authType === 'none' ? 'rgba(88, 166, 255, 0.1)' : 'var(--surface-1)',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="radio"
                      name="authType"
                      checked={authType === 'none'}
                      onChange={() => setAuthType('none')}
                      style={{ margin: 0 }}
                    />
                    <span>None (Local / Open)</span>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid ' + (authType === 'bearer' ? 'var(--info)' : 'var(--border-default)'),
                      backgroundColor: authType === 'bearer' ? 'rgba(88, 166, 255, 0.1)' : 'var(--surface-1)',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="radio"
                      name="authType"
                      checked={authType === 'bearer'}
                      onChange={() => setAuthType('bearer')}
                      style={{ margin: 0 }}
                    />
                    <span>API Key (Bearer)</span>
                  </label>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  {authType === 'bearer'
                    ? 'API key will be secured in Minfy CredentialStore. Never stored inside manifest file.'
                    : 'No credentials required. Connects directly to the endpoint.'}
                </p>
              </div>

              {/* Enabled checkbox */}
              <div style={{ paddingTop: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  <span>Enable this provider for active AI usage</span>
                </label>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '22px', marginTop: '2px' }}>
                  Disabled providers remain saved on disk but are inactive and hidden from the editor picker.
                </p>
              </div>

              {/* Advanced semantic defaults */}
              <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{ fontSize: '12px', color: 'var(--info)', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {showAdvanced ? '▼ Hide Metadata Defaults' : '▶ Advanced Metadata Defaults (Optional)'}
                </button>

                {showAdvanced && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '12px',
                      marginTop: '10px',
                      padding: '12px',
                      backgroundColor: 'var(--surface-1)',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        Inference Location
                      </label>
                      <select
                        value={executionLocation}
                        onChange={(e) => setExecutionLocation(e.target.value as AIExecutionLocation)}
                        style={{ width: '100%' }}
                      >
                        <option value="unknown">Unknown</option>
                        <option value="local">Local</option>
                        <option value="cloud">Cloud</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        Billing Classification
                      </label>
                      <select
                        value={billingType}
                        onChange={(e) => setBillingType(e.target.value as AIBillingType)}
                        style={{ width: '100%' }}
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
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="modal-btn modal-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="modal-btn modal-btn-primary"
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
