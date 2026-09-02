import React from 'react';
import { GitInfo, GitFileStatus } from '@minfy/shared';
import { GitBranch, RefreshCw, CheckCircle2, GitCommit, AlertCircle, FileCode } from 'lucide-react';

interface SourceControlViewProps {
  gitInfo: GitInfo | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenFile: (filePath: string) => void;
  activeFilePath: string | null;
}

export const SourceControlView: React.FC<SourceControlViewProps> = ({
  gitInfo,
  loading,
  onRefresh,
  onOpenFile,
  activeFilePath,
}) => {
  const renderStatusBadge = (status: GitFileStatus) => {
    let letter = 'M';
    let color = 'var(--minfy-yellow-accent)';
    let bg = 'rgba(250, 204, 21, 0.15)';

    if (status.isUntracked) {
      letter = 'U';
      color = 'var(--success)';
      bg = 'rgba(63, 185, 80, 0.15)';
    } else if (status.workingTreeStatus === 'D' || status.indexStatus === 'D') {
      letter = 'D';
      color = 'var(--danger)';
      bg = 'rgba(248, 81, 73, 0.15)';
    } else if (status.workingTreeStatus === 'R' || status.indexStatus === 'R') {
      letter = 'R';
      color = 'var(--info)';
      bg = 'rgba(88, 166, 255, 0.15)';
    } else if (status.indexStatus === 'A') {
      letter = 'A';
      color = 'var(--success)';
      bg = 'rgba(63, 185, 80, 0.15)';
    }

    return (
      <span
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '3px',
          backgroundColor: bg,
          color,
          fontSize: '11px',
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}
        title={`Status: ${letter}`}
      >
        {letter}
      </span>
    );
  };

  const renderFileList = (files: GitFileStatus[]) => {
    return files.map((file) => {
      const isSelected = activeFilePath === file.path;
      const isDeleted = file.workingTreeStatus === 'D' || file.indexStatus === 'D';

      return (
        <div
          key={file.path}
          onClick={() => {
            if (!isDeleted && file.isInsideWorkspace) {
              onOpenFile(file.path);
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 12px',
            backgroundColor: isSelected ? 'var(--surface-3)' : 'transparent',
            cursor: !isDeleted && file.isInsideWorkspace ? 'pointer' : 'default',
            borderLeft: isSelected ? '2px solid var(--minfy-yellow-accent)' : '2px solid transparent',
            gap: '8px',
            fontSize: '12px',
            color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
            transition: 'background-color 0.1s ease',
          }}
          onMouseEnter={(e) => {
            if (!isSelected && file.isInsideWorkspace && !isDeleted) {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <FileCode size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: isSelected ? 600 : 400,
                textDecoration: isDeleted ? 'line-through' : 'none',
              }}
              title={file.path}
            >
              {file.path}
            </span>
            {file.origPath && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                renamed from {file.origPath}
              </span>
            )}
          </div>
          {renderStatusBadge(file)}
        </div>
      );
    });
  };

  // Combine unstaged changes + untracked changes
  const unstagedAndUntracked = [
    ...(gitInfo?.modified.filter((f) => !f.isStaged) || []),
    ...(gitInfo?.untracked || []),
    ...(gitInfo?.deleted.filter((f) => !f.isStaged) || []),
    ...(gitInfo?.renamed.filter((f) => !f.isStaged) || []),
  ];

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
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            color: 'var(--text-muted)',
          }}
        >
          Source Control
        </span>

        <button
          onClick={onRefresh}
          title="Refresh Git Status"
          style={{ padding: '3px', borderRadius: '3px', color: 'var(--text-muted)' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Branch & Status Bar */}
      {gitInfo?.isRepository && (
        <div
          style={{
            padding: '8px 12px',
            backgroundColor: 'var(--surface-1)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <GitBranch size={13} color="var(--minfy-yellow-accent)" />
            <span
              style={{
                fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={gitInfo.branch || 'HEAD'}
            >
              {gitInfo.branch || 'HEAD'}
            </span>
          </div>

          <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
            {gitInfo.totalChanges} {gitInfo.totalChanges === 1 ? 'change' : 'changes'}
          </span>
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {!gitInfo?.available ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle size={24} color="var(--warning)" />
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Git Not Available</div>
            <span>Install Git CLI to enable repository source control status.</span>
          </div>
        ) : !gitInfo.isRepository ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <GitCommit size={24} color="var(--text-disabled)" />
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Not a Git Repository</div>
            <span>This workspace is not part of a Git repository.</span>
          </div>
        ) : gitInfo.totalChanges === 0 ? (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <CheckCircle2 size={24} color="var(--success)" />
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Working Tree Clean</div>
            <span>No modified, staged, or untracked changes.</span>
          </div>
        ) : (
          <div>
            {/* Staged Changes */}
            {gitInfo.staged.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Staged Changes</span>
                  <span>{gitInfo.staged.length}</span>
                </div>
                {renderFileList(gitInfo.staged)}
              </div>
            )}

            {/* Unstaged & Untracked Changes */}
            {unstagedAndUntracked.length > 0 && (
              <div>
                <div
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Changes</span>
                  <span>{unstagedAndUntracked.length}</span>
                </div>
                {renderFileList(unstagedAndUntracked)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
