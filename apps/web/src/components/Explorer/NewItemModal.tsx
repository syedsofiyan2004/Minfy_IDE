import React, { useState, useEffect, useRef } from 'react';
import { File, Folder, X } from 'lucide-react';

interface NewItemModalProps {
  isOpen: boolean;
  type: 'file' | 'directory';
  targetDirectoryPath: string;
  onClose: () => void;
  onCreate: (path: string, type: 'file' | 'directory') => Promise<void>;
}

export const NewItemModal: React.FC<NewItemModalProps> = ({
  isOpen,
  type,
  targetDirectoryPath,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Name cannot be empty');
      return;
    }

    if (cleanName.includes('/') || cleanName.includes('\\')) {
      setError('Please provide a valid entry name without slashes');
      return;
    }

    const fullPath = targetDirectoryPath ? `${targetDirectoryPath}/${cleanName}` : cleanName;

    try {
      setLoading(true);
      setError(null);
      await onCreate(fullPath, type);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '360px',
          backgroundColor: 'var(--surface-2)',
          border: '1px solid var(--border-default)',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            {type === 'directory' ? (
              <Folder size={16} color="var(--minfy-yellow-accent)" />
            ) : (
              <File size={16} color="var(--minfy-blue-primary)" />
            )}
            <span>New {type === 'directory' ? 'Folder' : 'File'}</span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '16px' }}>
          {targetDirectoryPath && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Inside: <span style={{ color: 'var(--text-secondary)' }}>/{targetDirectoryPath}</span>
            </div>
          )}

          <input
            ref={inputRef}
            type="text"
            placeholder={type === 'directory' ? 'folder-name' : 'filename.ts'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '13px',
              backgroundColor: 'var(--surface-1)',
              borderColor: error ? 'var(--danger)' : 'var(--border-default)',
            }}
          />

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '6px' }}>{error}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                backgroundColor: 'var(--surface-3)',
                color: 'var(--text-secondary)',
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '6px 14px',
                borderRadius: '4px',
                backgroundColor: 'var(--minfy-blue-primary)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '12px',
              }}
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
