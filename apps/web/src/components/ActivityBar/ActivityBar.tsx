import React from 'react';
import { Files, GitBranch, Layers, Sparkles } from 'lucide-react';

export type ActivityView = 'explorer' | 'source-control' | 'project' | 'ai';

interface ActivityBarProps {
  activeView: ActivityView;
  onChangeView: (view: ActivityView) => void;
  changesCount: number;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeView,
  onChangeView,
  changesCount,
}) => {
  return (
    <aside
      style={{
        width: '44px',
        backgroundColor: 'var(--surface-0)',
        borderRight: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '6px',
        userSelect: 'none',
        flexShrink: 0,
        zIndex: 30,
      }}
    >
      {/* Explorer Action */}
      <button
        onClick={() => onChangeView('explorer')}
        title="Explorer (Files)"
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '6px',
          backgroundColor: activeView === 'explorer' ? 'var(--surface-2)' : 'transparent',
          color: activeView === 'explorer' ? 'var(--text-primary)' : 'var(--text-muted)',
          position: 'relative',
          marginBottom: '4px',
        }}
      >
        {activeView === 'explorer' && (
          <div
            style={{
              position: 'absolute',
              left: '-3px',
              top: '8px',
              bottom: '8px',
              width: '2px',
              backgroundColor: 'var(--minfy-blue-primary)',
              borderRadius: '0 2px 2px 0',
            }}
          />
        )}
        <Files size={18} />
      </button>

      {/* Source Control Action */}
      <button
        onClick={() => onChangeView('source-control')}
        title={`Source Control (${changesCount} changes)`}
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '6px',
          backgroundColor: activeView === 'source-control' ? 'var(--surface-2)' : 'transparent',
          color: activeView === 'source-control' ? 'var(--text-primary)' : 'var(--text-muted)',
          position: 'relative',
          marginBottom: '4px',
        }}
      >
        {activeView === 'source-control' && (
          <div
            style={{
              position: 'absolute',
              left: '-3px',
              top: '8px',
              bottom: '8px',
              width: '2px',
              backgroundColor: 'var(--minfy-blue-primary)',
              borderRadius: '0 2px 2px 0',
            }}
          />
        )}
        <GitBranch size={18} />
        {changesCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              backgroundColor: 'var(--minfy-blue-primary)',
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 700,
              minWidth: '14px',
              height: '14px',
              borderRadius: '7px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
            }}
          >
            {changesCount > 99 ? '99+' : changesCount}
          </span>
        )}
      </button>

      {/* Project Intelligence Action */}
      <button
        onClick={() => onChangeView('project')}
        title="Project Intelligence (0 AI tokens)"
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '6px',
          backgroundColor: activeView === 'project' ? 'var(--surface-2)' : 'transparent',
          color: activeView === 'project' ? 'var(--text-primary)' : 'var(--text-muted)',
          position: 'relative',
          marginBottom: '4px',
        }}
      >
        {activeView === 'project' && (
          <div
            style={{
              position: 'absolute',
              left: '-3px',
              top: '8px',
              bottom: '8px',
              width: '2px',
              backgroundColor: 'var(--minfy-blue-primary)',
              borderRadius: '0 2px 2px 0',
            }}
          />
        )}
        <Layers size={18} />
      </button>

      {/* AI Provider Action (Milestone 3) */}
      <button
        onClick={() => onChangeView('ai')}
        title="AI Assistant (Ollama Local)"
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '6px',
          backgroundColor: activeView === 'ai' ? 'var(--surface-2)' : 'transparent',
          color: activeView === 'ai' ? 'var(--minfy-yellow-accent)' : 'var(--text-muted)',
          position: 'relative',
          marginBottom: '4px',
        }}
      >
        {activeView === 'ai' && (
          <div
            style={{
              position: 'absolute',
              left: '-3px',
              top: '8px',
              bottom: '8px',
              width: '2px',
              backgroundColor: 'var(--minfy-blue-primary)',
              borderRadius: '0 2px 2px 0',
            }}
          />
        )}
        <Sparkles size={18} />
      </button>
    </aside>
  );
};
