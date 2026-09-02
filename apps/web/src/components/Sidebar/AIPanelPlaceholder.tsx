import React from 'react';
import { Sparkles, X, Layers, Cpu, ShieldCheck } from 'lucide-react';

interface AIPanelPlaceholderProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AIPanelPlaceholder: React.FC<AIPanelPlaceholderProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        width: '280px',
        backgroundColor: 'var(--surface-2)',
        borderLeft: '1px solid var(--border-default)',
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
          height: '34px',
          padding: '0 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
          <Sparkles size={13} color="var(--minfy-yellow-accent)" />
          <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            AI Assistant
          </span>
        </div>
        <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
          <X size={14} />
        </button>
      </div>

      {/* Placeholder Content */}
      <div
        style={{
          flex: 1,
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            backgroundColor: 'var(--surface-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Sparkles size={22} color="var(--minfy-yellow-accent)" />
        </div>

        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Minfy Intelligence
        </div>

        <div
          style={{
            padding: '2px 8px',
            borderRadius: '10px',
            backgroundColor: 'var(--minfy-yellow-muted)',
            color: 'var(--minfy-yellow-accent)',
            fontSize: '11px',
            fontWeight: 500,
          }}
        >
          Coming in Milestone 2
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5', marginTop: '4px' }}>
          Provider-agnostic context compilation, multi-model routing, and local tool execution will be available in future milestones.
        </p>

        <div
          style={{
            marginTop: '16px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              padding: '8px 10px',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
            }}
          >
            <Layers size={13} color="var(--minfy-blue-primary)" />
            <span>Context Compiler</span>
          </div>

          <div
            style={{
              padding: '8px 10px',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
            }}
          >
            <Cpu size={13} color="var(--minfy-blue-primary)" />
            <span>Multi-Model Orchestration</span>
          </div>

          <div
            style={{
              padding: '8px 10px',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
            }}
          >
            <ShieldCheck size={13} color="var(--minfy-blue-primary)" />
            <span>Zero Data Leakage Guard</span>
          </div>
        </div>
      </div>
    </div>
  );
};
