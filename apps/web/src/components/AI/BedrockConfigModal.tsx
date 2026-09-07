import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.js';
import {
  X,
  Cloud,
  CheckCircle,
  AlertCircle,
  Loader2,
  HelpCircle,
} from 'lucide-react';

interface BedrockConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess: () => Promise<void>;
}

const COMMON_BEDROCK_REGIONS = [
  { id: 'us-east-1', name: 'US East (N. Virginia) [us-east-1]' },
  { id: 'us-west-2', name: 'US West (Oregon) [us-west-2]' },
  { id: 'ap-south-1', name: 'Asia Pacific (Mumbai) [ap-south-1]' },
  { id: 'eu-central-1', name: 'Europe (Frankfurt) [eu-central-1]' },
  { id: 'ap-southeast-1', name: 'Asia Pacific (Singapore) [ap-southeast-1]' },
  { id: 'ap-northeast-1', name: 'Asia Pacific (Tokyo) [ap-northeast-1]' },
  { id: 'custom', name: 'Custom AWS Region...' },
];

export const BedrockConfigModal: React.FC<BedrockConfigModalProps> = ({
  isOpen,
  onClose,
  onSaveSuccess,
}) => {
  const [selectedRegion, setSelectedRegion] = useState<string>('us-east-1');
  const [customRegion, setCustomRegion] = useState<string>('');
  const [profile, setProfile] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    identity?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTestResult(null);
      setError(null);
      setLoading(true);

      api.getBedrockConfig()
        .then((cfg) => {
          if (cfg.region) {
            const isCommon = COMMON_BEDROCK_REGIONS.some((r) => r.id === cfg.region);
            if (isCommon) {
              setSelectedRegion(cfg.region);
            } else {
              setSelectedRegion('custom');
              setCustomRegion(cfg.region);
            }
          }
          if (cfg.profile) {
            setProfile(cfg.profile);
          }
        })
        .catch((err) => {
          setError(err.message || 'Failed to load current Bedrock configuration.');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen]);

  const getEffectiveRegion = (): string => {
    if (selectedRegion === 'custom') {
      return customRegion.trim().toLowerCase();
    }
    return selectedRegion.trim().toLowerCase();
  };

  const handleTestConnection = async () => {
    setError(null);
    setTestResult(null);
    setIsTesting(true);

    const effRegion = getEffectiveRegion();
    if (!effRegion) {
      setError('AWS Region is required.');
      setIsTesting(false);
      return;
    }

    try {
      // 1. Temporarily save config to runtime
      await api.updateBedrockConfig({
        region: effRegion,
        profile: profile.trim() || undefined,
      });

      // 2. Test connection
      const res = await api.testBedrockConnection();
      if (res.connected) {
        setTestResult({
          success: true,
          message: `Connected to AWS Bedrock in ${effRegion}. Discovered ${res.modelsCount ?? 0} Bedrock inference targets.`,
          identity: res.identity,
        });
      } else {
        setTestResult({
          success: false,
          message: res.reason || 'AWS authentication or Bedrock authorization failed.',
          identity: res.identity,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Connection test failed.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const effRegion = getEffectiveRegion();
    if (!effRegion) {
      setError('AWS Region is required.');
      return;
    }

    try {
      setIsSaving(true);
      await api.updateBedrockConfig({
        region: effRegion,
        profile: profile.trim() || undefined,
      });

      await onSaveSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save Bedrock configuration.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-md" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Cloud size={18} color="var(--info)" />
            <span>Configure AWS Bedrock</span>
          </div>
          <button onClick={onClose} className="modal-close-btn" title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="modal-body" style={{ gap: '14px' }}>
          {error && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'rgba(248, 81, 73, 0.1)',
                border: '1px solid rgba(248, 81, 73, 0.3)',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {testResult && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid ' + (testResult.success ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)'),
                backgroundColor: testResult.success ? 'rgba(63, 185, 80, 0.1)' : 'rgba(248, 81, 73, 0.1)',
                color: testResult.success ? 'var(--success)' : 'var(--danger)',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                {testResult.success ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                <span>{testResult.success ? 'Connection Successful' : 'Connection Failed'}</span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{testResult.message}</p>
              {testResult.identity && (
                <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {testResult.identity}
                </div>
              )}
            </div>
          )}

          {/* Region Selection */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              AWS Region <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              disabled={loading}
              style={{ width: '100%', cursor: 'pointer' }}
            >
              {COMMON_BEDROCK_REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            {selectedRegion === 'custom' && (
              <input
                type="text"
                value={customRegion}
                onChange={(e) => setCustomRegion(e.target.value)}
                placeholder="e.g. us-east-2"
                required
                style={{ width: '100%', marginTop: '8px', fontFamily: 'var(--font-mono)' }}
              />
            )}
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Bedrock availability and model access varies across AWS Regions.
            </p>
          </div>

          {/* Profile Name */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              AWS Profile <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>(Optional)</span>
            </label>
            <input
              type="text"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="e.g. default, bedrock-main, or leave blank"
              style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Named profile in your local ~/.aws/credentials or ~/.aws/config file.
            </p>
          </div>

          {/* Security Note */}
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              fontSize: '11px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              lineHeight: 1.5,
            }}
          >
            <HelpCircle size={15} color="var(--info)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Native AWS Authentication:</strong> Minfy connects via the standard AWS SDK v3 credential chain (SSO, IAM Identity Center, environment variables, or named profiles). Your AWS secret keys are never requested or stored.
            </div>
          </div>

          {/* Action Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
              marginTop: '4px',
            }}
          >
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isSaving}
              className="modal-btn modal-btn-secondary"
            >
              {isTesting && <Loader2 size={13} className="animate-spin" />}
              <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || isTesting}
                className="modal-btn modal-btn-primary"
              >
                {isSaving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
