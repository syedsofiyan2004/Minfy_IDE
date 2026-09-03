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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#181825] border border-[#313244] rounded-lg shadow-2xl w-full max-w-md flex flex-col max-h-[85vh] overflow-hidden text-[#cdd6f4]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#313244]">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[#89b4fa]" />
            <h2 className="text-base font-semibold text-[#cdd6f4]">
              Configure AWS Bedrock
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#a6adc8] hover:text-[#cdd6f4] p-1 rounded-md hover:bg-[#313244] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-2.5 bg-[#f38ba8]/10 border border-[#f38ba8]/30 rounded text-xs text-[#f38ba8] flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {testResult && (
            <div
              className={`p-3 rounded border text-xs space-y-1 ${
                testResult.success
                  ? 'bg-[#a6e3a1]/10 border-[#a6e3a1]/30 text-[#a6e3a1]'
                  : 'bg-[#f38ba8]/10 border-[#f38ba8]/30 text-[#f38ba8]'
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {testResult.success ? (
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                )}
                <span>{testResult.success ? 'Connection Successful' : 'Connection Failed'}</span>
              </div>
              <p className="text-[11px] text-[#cdd6f4]">{testResult.message}</p>
              {testResult.identity && (
                <div className="text-[10px] font-mono text-[#a6adc8] pt-1">
                  {testResult.identity}
                </div>
              )}
            </div>
          )}

          {/* Region Selection */}
          <div>
            <label className="block text-xs font-medium text-[#a6adc8] mb-1">
              AWS Region <span className="text-[#f38ba8]">*</span>
            </label>
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              disabled={loading}
              className="w-full bg-[#1e1e2e] border border-[#313244] focus:border-[#89b4fa] rounded px-3 py-1.5 text-xs text-[#cdd6f4] outline-none"
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
                className="w-full mt-2 bg-[#1e1e2e] border border-[#313244] focus:border-[#89b4fa] rounded px-3 py-1.5 text-xs font-mono text-[#cdd6f4] placeholder-[#6c7086] outline-none"
              />
            )}
            <p className="text-[10px] text-[#6c7086] mt-0.5">
              Bedrock availability and model access varies across AWS Regions.
            </p>
          </div>

          {/* Profile Name */}
          <div>
            <label className="block text-xs font-medium text-[#a6adc8] mb-1">
              AWS Profile <span className="text-[10px] text-[#6c7086]">(Optional)</span>
            </label>
            <input
              type="text"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="e.g. default, bedrock-main, or leave blank"
              className="w-full bg-[#1e1e2e] border border-[#313244] focus:border-[#89b4fa] rounded px-3 py-1.5 text-xs font-mono text-[#cdd6f4] placeholder-[#6c7086] outline-none"
            />
            <p className="text-[10px] text-[#6c7086] mt-0.5">
              Named profile in your local ~/.aws/credentials or ~/.aws/config file.
            </p>
          </div>

          {/* Security Note */}
          <div className="p-3 bg-[#1e1e2e] border border-[#313244] rounded text-xs text-[#a6adc8] flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-[#89b4fa] flex-shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-semibold text-[#cdd6f4]">Native AWS Authentication:</span> Minfy connects via the standard AWS SDK v3 credential chain (SSO, IAM Identity Center, environment variables, or named profiles). Your AWS secret keys are never requested or stored.
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-[#313244]">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#89b4fa] bg-[#89b4fa]/10 hover:bg-[#89b4fa]/20 border border-[#89b4fa]/30 font-medium rounded transition-colors"
            >
              {isTesting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isTesting ? 'Testing...' : 'Test Connection'}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-[#cdd6f4] bg-[#313244] hover:bg-[#45475a] rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || isTesting}
                className="px-4 py-1.5 text-xs text-[#11111b] bg-[#89b4fa] hover:bg-[#b4befe] font-semibold rounded transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
