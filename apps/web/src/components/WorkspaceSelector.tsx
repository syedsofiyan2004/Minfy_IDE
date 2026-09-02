import React, { useState } from 'react';
import { Workspace } from '@minfy/shared';
import { ArrowRight, Clock, HardDrive, Terminal } from 'lucide-react';

interface WorkspaceSelectorProps {
  recentWorkspaces: Workspace[];
  onSelectWorkspace: (workspace: Workspace) => void;
  onOpenPath: (path: string) => Promise<void>;
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({
  recentWorkspaces,
  onSelectWorkspace,
  onOpenPath,
}) => {
  const [inputPath, setInputPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPath.trim()) return;

    try {
      setLoading(true);
      setError(null);
      await onOpenPath(inputPath.trim());
    } catch (err: any) {
      setError(err.message || 'Failed to open directory');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        backgroundColor: 'var(--surface-0)',
        padding: '24px',
        color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          backgroundColor: 'var(--surface-2)',
          border: '1px solid var(--border-default)',
          borderRadius: '10px',
          padding: '28px',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, var(--minfy-blue-primary), #1e40af)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                backgroundColor: 'var(--minfy-yellow-accent)',
                borderRadius: '2px',
                transform: 'rotate(45deg)',
              }}
            />
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>
              Minfy <span style={{ color: 'var(--minfy-yellow-accent)' }}>IDE</span>
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              Local Development Workspace
            </p>
          </div>
        </div>

        {/* CLI Quick Hint */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '6px',
            backgroundColor: 'var(--surface-1)',
            border: '1px solid var(--border-subtle)',
            marginBottom: '20px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <Terminal size={16} color="var(--minfy-yellow-accent)" />
          <div style={{ color: 'var(--text-secondary)' }}>
            Open any folder from terminal using: <code style={{ color: 'var(--minfy-yellow-accent)', fontWeight: 600 }}>minfy .</code>
          </div>
        </div>

        {/* Open by Path Form */}
        <form onSubmit={handleSubmit} style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Open Local Workspace Directory
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="e.g. C:\projects\my-app or /home/user/project"
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              disabled={loading}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '13px',
                backgroundColor: 'var(--surface-1)',
              }}
            />
            <button
              type="submit"
              disabled={loading || !inputPath.trim()}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                backgroundColor: 'var(--minfy-blue-primary)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '13px',
                gap: '6px',
              }}
            >
              <span>{loading ? 'Opening...' : 'Open'}</span>
              <ArrowRight size={14} />
            </button>
          </div>
          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '6px' }}>{error}</div>
          )}
        </form>

        {/* Recent Workspaces */}
        {recentWorkspaces.length > 0 && (
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                color: 'var(--text-muted)',
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Clock size={12} />
              <span>Recent Workspaces</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {recentWorkspaces.map((ws) => (
                <div
                  key={ws.id}
                  onClick={() => onSelectWorkspace(ws)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--minfy-blue-primary)';
                    e.currentTarget.style.backgroundColor = 'var(--surface-3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.backgroundColor = 'var(--surface-1)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <HardDrive size={16} color="var(--minfy-yellow-accent)" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                        {ws.name}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {ws.rootPath}
                      </div>
                    </div>
                  </div>

                  <ArrowRight size={14} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
