import React, { useState } from 'react';
import { FileNode } from '@minfy/shared';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  FileSpreadsheet,
  File,
  Plus,
  FolderPlus,
  Loader2,
} from 'lucide-react';

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  activeFilePath: string | null;
  onSelectFile: (node: FileNode) => void;
  onLoadDirectory: (node: FileNode) => Promise<void>;
  onOpenNewItemModal: (parentDir: string, type: 'file' | 'directory') => void;
}

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  depth,
  activeFilePath,
  onSelectFile,
  onLoadDirectory,
  onOpenNewItemModal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isDirectory = node.type === 'directory';
  const isSelected = !isDirectory && activeFilePath === node.path;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDirectory) {
      if (!isOpen && !node.isLoaded) {
        setIsLoading(true);
        try {
          await onLoadDirectory(node);
        } finally {
          setIsLoading(false);
        }
      }
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node);
    }
  };

  const getFileIcon = () => {
    const ext = node.extension?.toLowerCase() || '';
    if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp'].includes(ext)) {
      return <FileCode size={14} color="var(--info)" />;
    }
    if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
      return <FileJson size={14} color="var(--minfy-yellow-accent)" />;
    }
    if (['.md', '.txt', '.log'].includes(ext)) {
      return <FileText size={14} color="var(--text-secondary)" />;
    }
    if (['.csv', '.xlsx'].includes(ext)) {
      return <FileSpreadsheet size={14} color="var(--success)" />;
    }
    return <File size={14} color="var(--text-muted)" />;
  };

  return (
    <div>
      <div
        onClick={handleToggle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '3px 8px',
          paddingLeft: `${depth * 14 + 10}px`,
          backgroundColor: isSelected
            ? 'var(--surface-3)'
            : isHovered
            ? 'rgba(255, 255, 255, 0.04)'
            : 'transparent',
          borderLeft: isSelected ? '2px solid var(--minfy-yellow-accent)' : '2px solid transparent',
          cursor: 'pointer',
          fontSize: '12px',
          color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
          gap: '5px',
          userSelect: 'none',
          position: 'relative',
        }}
      >
        {/* Chevron or spacer */}
        {isDirectory ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', width: '12px' }}>
            {isLoading ? (
              <Loader2 size={11} className="animate-spin" color="var(--text-muted)" />
            ) : isOpen ? (
              <ChevronDown size={12} color="var(--text-muted)" />
            ) : (
              <ChevronRight size={12} color="var(--text-muted)" />
            )}
          </span>
        ) : (
          <span style={{ width: '12px' }} />
        )}

        {/* Directory or File Icon */}
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {isDirectory ? (
            isOpen ? (
              <FolderOpen size={14} color="var(--minfy-yellow-accent)" />
            ) : (
              <Folder size={14} color="var(--minfy-yellow-accent)" />
            )
          ) : (
            getFileIcon()
          )}
        </span>

        {/* Name */}
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: isSelected ? 600 : 400,
          }}
          title={node.name}
        >
          {node.name}
        </span>

        {/* Folder quick actions on hover */}
        {isDirectory && isHovered && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              marginLeft: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onOpenNewItemModal(node.path, 'file')}
              title="New File Inside"
              style={{ padding: '2px', color: 'var(--text-muted)' }}
            >
              <Plus size={12} />
            </button>
            <button
              onClick={() => onOpenNewItemModal(node.path, 'directory')}
              title="New Folder Inside"
              style={{ padding: '2px', color: 'var(--text-muted)' }}
            >
              <FolderPlus size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Render children if folder is open */}
      {isDirectory && isOpen && (
        <div>
          {node.children && node.children.length > 0 ? (
            node.children.map((child) => (
              <FileTreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                onSelectFile={onSelectFile}
                onLoadDirectory={onLoadDirectory}
                onOpenNewItemModal={onOpenNewItemModal}
              />
            ))
          ) : node.isLoaded ? (
            <div
              style={{
                paddingLeft: `${(depth + 1) * 14 + 22}px`,
                paddingTop: '2px',
                paddingBottom: '2px',
                fontSize: '11px',
                color: 'var(--text-disabled)',
                fontStyle: 'italic',
              }}
            >
              (empty)
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
