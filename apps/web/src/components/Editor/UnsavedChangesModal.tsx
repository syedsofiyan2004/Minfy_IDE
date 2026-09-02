import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Save, Trash2, X } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  filename: string;
  isSaving: boolean;
  onSaveAndContinue: () => Promise<void>;
  onDiscardChanges: () => void;
  onCancel: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  filename,
  isSaving,
  onSaveAndContinue,
  onDiscardChanges,
  onCancel,
}) => {
  const saveBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => saveBtnRef.current?.focus(), 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        backdropFilter: 'blur(3px)',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: '420px',
          backgroundColor: 'var(--surface-2)',
          border: '1px solid var(--border-default)',
          borderRadius: '8px',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px' }}>
            <AlertTriangle size={16} color="var(--minfy-yellow-accent)" />
            <span>Unsaved Changes</span>
          </div>
          <button
            onClick={onCancel}
            style={{ color: 'var(--text-muted)' }}
            disabled={isSaving}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 16px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          <p>
            <strong style={{ color: 'var(--text-primary)' }}>{filename}</strong> has unsaved changes.
          </p>
          <p style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '12px' }}>
            Do you want to save your changes before continuing?
          </p>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--surface-1)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              backgroundColor: 'var(--surface-3)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onDiscardChanges}
            disabled={isSaving}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              backgroundColor: 'rgba(248, 81, 73, 0.12)',
              color: 'var(--danger)',
              fontSize: '12px',
              border: '1px solid rgba(248, 81, 73, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <Trash2 size={13} />
            <span>Discard Changes</span>
          </button>

          <button
            ref={saveBtnRef}
            type="button"
            onClick={onSaveAndContinue}
            disabled={isSaving}
            style={{
              padding: '6px 14px',
              borderRadius: '4px',
              backgroundColor: 'var(--minfy-blue-primary)',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Save size={13} />
            <span>{isSaving ? 'Saving...' : 'Save & Continue'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
