import React, { useState } from 'react';
import { FileNode } from '@minfy/shared';
import { FileTreeNode } from './FileTreeNode.js';
import { NewItemModal } from './NewItemModal.js';
import { FilePlus, FolderPlus, RefreshCw, AlertCircle, Folder } from 'lucide-react';

interface FileTreeProps {
  nodes: FileNode[];
  loading: boolean;
  error: string | null;
  activeFilePath: string | null;
  onSelectFile: (node: FileNode) => void;
  onLoadDirectory: (node: FileNode) => Promise<void>;
  onRefresh: () => Promise<void>;
  onCreateEntry: (path: string, type: 'file' | 'directory') => Promise<void>;
}

export const FileTree: React.FC<FileTreeProps> = ({
  nodes,
  loading,
  error,
  activeFilePath,
  onSelectFile,
  onLoadDirectory,
  onRefresh,
  onCreateEntry,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'file' | 'directory'>('file');
  const [modalTargetPath, setModalTargetPath] = useState('');

  const handleOpenNewItem = (parentDir: string, type: 'file' | 'directory') => {
    setModalTargetPath(parentDir);
    setModalType(type);
    setModalOpen(true);
  };

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
      {/* Explorer Header */}
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
          Explorer
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => handleOpenNewItem('', 'file')}
            title="New File"
            style={{
              padding: '3px',
              borderRadius: '3px',
              color: 'var(--text-muted)',
            }}
          >
            <FilePlus size={14} />
          </button>
          <button
            onClick={() => handleOpenNewItem('', 'directory')}
            title="New Folder"
            style={{
              padding: '3px',
              borderRadius: '3px',
              color: 'var(--text-muted)',
            }}
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={onRefresh}
            title="Refresh Explorer"
            style={{
              padding: '3px',
              borderRadius: '3px',
              color: 'var(--text-muted)',
            }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tree Content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
        {error ? (
          <div
            style={{
              padding: '16px 12px',
              color: 'var(--danger)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
              <AlertCircle size={14} />
              <span>Failed to load explorer</span>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{error}</span>
            <button
              onClick={onRefresh}
              style={{
                marginTop: '8px',
                padding: '4px 8px',
                borderRadius: '4px',
                backgroundColor: 'var(--surface-3)',
                color: 'var(--text-secondary)',
                alignSelf: 'flex-start',
              }}
            >
              Retry
            </button>
          </div>
        ) : nodes.length === 0 && !loading ? (
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
            <Folder size={24} color="var(--text-disabled)" />
            <span>Workspace folder is empty</span>
            <button
              onClick={() => handleOpenNewItem('', 'file')}
              style={{
                marginTop: '4px',
                padding: '4px 10px',
                borderRadius: '4px',
                backgroundColor: 'var(--minfy-blue-primary)',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              Create File
            </button>
          </div>
        ) : (
          nodes.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              depth={0}
              activeFilePath={activeFilePath}
              onSelectFile={onSelectFile}
              onLoadDirectory={onLoadDirectory}
              onOpenNewItemModal={handleOpenNewItem}
            />
          ))
        )}
      </div>

      {/* New File / Folder Modal */}
      <NewItemModal
        isOpen={modalOpen}
        type={modalType}
        targetDirectoryPath={modalTargetPath}
        onClose={() => setModalOpen(false)}
        onCreate={onCreateEntry}
      />
    </div>
  );
};
