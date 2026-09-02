import React from 'react';
import { Workspace } from '@minfy/shared';
import { Folder, Terminal as TerminalIcon, Sparkles, RefreshCw } from 'lucide-react';

interface HeaderProps {
  workspace: Workspace | null;
  runtimeConnected: boolean;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  aiPanelOpen: boolean;
  onToggleAiPanel: () => void;
  onRefreshWorkspace?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  workspace,
  runtimeConnected,
  terminalOpen,
  onToggleTerminal,
  aiPanelOpen,
  onToggleAiPanel,
  onRefreshWorkspace,
}) => {
  return (
    <header
      style={{
        height: 'var(--header-height)',
        backgroundColor: 'var(--surface-2)',
        borderBottom: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        zIndex: 50,
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: 700,
            fontSize: '13px',
            letterSpacing: '0.5px',
            color: 'var(--text-primary)',
          }}
        >
          <div
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '4px',
              background: 'linear-gradient(135deg, var(--minfy-blue-primary), #1e40af)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                width: '6px',
                height: '6px',
                backgroundColor: 'var(--minfy-yellow-accent)',
                borderRadius: '1px',
                transform: 'rotate(45deg)',
              }}
            />
          </div>
          <span>MINFY <span style={{ color: 'var(--minfy-yellow-accent)', fontWeight: 600 }}>IDE</span></span>
        </div>

        {/* Workspace info badge */}
        {workspace && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginLeft: '16px',
              padding: '2px 10px',
              backgroundColor: 'var(--surface-3)',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              fontSize: '12px',
            }}
            title={workspace.rootPath}
          >
            <Folder size={13} color="var(--minfy-yellow-accent)" />
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{workspace.name}</span>
            <span
              style={{
                color: 'var(--text-muted)',
                fontSize: '11px',
                maxWidth: '280px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {workspace.rootPath}
            </span>
          </div>
        )}
      </div>

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Refresh button */}
        {workspace && onRefreshWorkspace && (
          <button
            onClick={onRefreshWorkspace}
            title="Refresh Workspace"
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              gap: '4px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--surface-3)',
            }}
          >
            <RefreshCw size={12} />
          </button>
        )}

        {/* Terminal Toggle Button */}
        <button
          onClick={onToggleTerminal}
          style={{
            padding: '4px 10px',
            borderRadius: '4px',
            backgroundColor: terminalOpen ? 'var(--minfy-blue-primary)' : 'var(--surface-3)',
            color: terminalOpen ? '#ffffff' : 'var(--text-secondary)',
            border: '1px solid',
            borderColor: terminalOpen ? 'var(--minfy-blue-primary)' : 'var(--border-subtle)',
            fontSize: '12px',
            gap: '6px',
            fontWeight: 500,
          }}
          title="Toggle Integrated Terminal"
        >
          <TerminalIcon size={13} />
          <span>Terminal</span>
        </button>

        {/* AI Assistant Toggle Button (Placeholder) */}
        <button
          onClick={onToggleAiPanel}
          style={{
            padding: '4px 10px',
            borderRadius: '4px',
            backgroundColor: aiPanelOpen ? 'var(--surface-4)' : 'var(--surface-3)',
            color: aiPanelOpen ? 'var(--minfy-yellow-accent)' : 'var(--text-muted)',
            border: '1px solid var(--border-subtle)',
            fontSize: '12px',
            gap: '6px',
          }}
          title="Toggle AI Panel (Milestone 2+)"
        >
          <Sparkles size={13} color={aiPanelOpen ? 'var(--minfy-yellow-accent)' : 'var(--text-muted)'} />
          <span>AI</span>
        </button>

        {/* Runtime Connectivity Status Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 10px',
            borderRadius: '12px',
            backgroundColor: 'var(--surface-3)',
            border: '1px solid var(--border-subtle)',
            fontSize: '11px',
            color: 'var(--text-secondary)',
          }}
        >
          <div
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: runtimeConnected ? 'var(--success)' : 'var(--danger)',
              boxShadow: runtimeConnected ? '0 0 6px rgba(63, 185, 80, 0.6)' : '0 0 6px rgba(248, 81, 73, 0.6)',
            }}
          />
          <span>{runtimeConnected ? 'Runtime Connected' : 'Runtime Offline'}</span>
        </div>
      </div>
    </header>
  );
};
