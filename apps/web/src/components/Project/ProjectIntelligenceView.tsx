import React from 'react';
import { ProjectIntelligence } from '@minfy/shared';
import {
  Layers,
  RefreshCw,
  Code2,
  Box,
  Package,
  Wrench,
  Cloud,
  Workflow,
  FileText,
  Zap,
  CheckCircle2,
} from 'lucide-react';

interface ProjectIntelligenceViewProps {
  intelligence: ProjectIntelligence | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenFile: (filePath: string) => void;
}

export const ProjectIntelligenceView: React.FC<ProjectIntelligenceViewProps> = ({
  intelligence,
  loading,
  onRefresh,
  onOpenFile,
}) => {
  const project = intelligence?.project;

  const renderSectionHeader = (icon: React.ReactNode, title: string) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.6px',
        color: 'var(--text-muted)',
        marginBottom: '6px',
      }}
    >
      {icon}
      <span>{title}</span>
    </div>
  );

  const renderTag = (text: string, subtitle?: string, accentColor?: string) => (
    <span
      key={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 8px',
        borderRadius: '4px',
        backgroundColor: 'var(--surface-1)',
        border: '1px solid var(--border-subtle)',
        fontSize: '12px',
        color: accentColor || 'var(--text-primary)',
        marginRight: '6px',
        marginBottom: '6px',
      }}
    >
      <span style={{ fontWeight: 500 }}>{text}</span>
      {subtitle && (
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
          ({subtitle})
        </span>
      )}
    </span>
  );

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
          <Layers size={13} color="var(--minfy-blue-primary)" />
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              color: 'var(--text-muted)',
            }}
          >
            Project Intelligence
          </span>
        </div>

        <button
          onClick={onRefresh}
          title="Refresh Project Intelligence"
          style={{ padding: '3px', borderRadius: '3px', color: 'var(--text-muted)' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Zero-AI Local Analysis Banner */}
      <div
        style={{
          padding: '6px 12px',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          borderBottom: '1px solid rgba(37, 99, 235, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--info)' }}>
          <Zap size={12} color="var(--minfy-yellow-accent)" />
          <span>Local Analysis</span>
        </div>
        <span
          style={{
            padding: '1px 6px',
            borderRadius: '10px',
            backgroundColor: 'var(--surface-3)',
            color: 'var(--minfy-yellow-accent)',
            fontWeight: 600,
            fontSize: '10px',
          }}
        >
          0 AI tokens
        </span>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {project ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Project Name */}
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {project.name}
              </div>
              {intelligence.git.branch && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Branch: <span style={{ color: 'var(--minfy-yellow-accent)' }}>{intelligence.git.branch}</span>
                </div>
              )}
            </div>

            {/* Languages */}
            {project.detectedLanguages.length > 0 && (
              <div>
                {renderSectionHeader(<Code2 size={12} />, 'Languages')}
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  {project.detectedLanguages.map((l) =>
                    renderTag(l.name, l.category !== 'programming' ? l.category : undefined)
                  )}
                </div>
              </div>
            )}

            {/* Frameworks */}
            {project.frameworks.length > 0 && (
              <div>
                {renderSectionHeader(<Box size={12} />, 'Frameworks & Libraries')}
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  {project.frameworks.map((f) =>
                    renderTag(f.name, f.category, 'var(--info)')
                  )}
                </div>
              </div>
            )}

            {/* Package Managers */}
            {project.packageManagers.length > 0 && (
              <div>
                {renderSectionHeader(<Package size={12} />, 'Package Manager')}
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  {project.packageManagers.map((pm) =>
                    renderTag(pm.name, pm.lockfile ? `lock: ${pm.lockfile}` : undefined)
                  )}
                </div>
              </div>
            )}

            {/* Build Systems */}
            {project.buildSystems.length > 0 && (
              <div>
                {renderSectionHeader(<Wrench size={12} />, 'Build Systems & Runtimes')}
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  {project.buildSystems.map((b) => renderTag(b))}
                </div>
              </div>
            )}

            {/* Infrastructure */}
            {project.infrastructure.length > 0 && (
              <div>
                {renderSectionHeader(<Cloud size={12} />, 'Infrastructure & DevOps')}
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  {project.infrastructure.map((inf) =>
                    renderTag(inf, undefined, 'var(--minfy-yellow-accent)')
                  )}
                </div>
              </div>
            )}

            {/* CI / CD */}
            {project.ciCd.length > 0 && (
              <div>
                {renderSectionHeader(<Workflow size={12} />, 'CI / CD')}
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  {project.ciCd.map((ci) => renderTag(ci, undefined, 'var(--success)'))}
                </div>
              </div>
            )}

            {/* Important Files */}
            {project.importantFiles.length > 0 && (
              <div>
                {renderSectionHeader(<FileText size={12} />, 'Important Project Files')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {project.importantFiles.map((file) => (
                    <div
                      key={file}
                      onClick={() => onOpenFile(file)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: 'var(--surface-1)',
                        borderRadius: '4px',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.1s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--surface-3)';
                        e.currentTarget.style.borderColor = 'var(--minfy-blue-primary)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--surface-1)';
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }}
                    >
                      <FileText size={12} color="var(--text-muted)" />
                      <span>{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis Diagnostics */}
            <div
              style={{
                marginTop: '8px',
                paddingTop: '8px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '10px',
                color: 'var(--text-disabled)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={10} color="var(--success)" />
                <span>Deterministic</span>
              </div>
              <span>{intelligence.analysisTimeMs}ms</span>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '24px 8px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
            }}
          >
            Analyzing repository structure...
          </div>
        )}
      </div>
    </div>
  );
};
