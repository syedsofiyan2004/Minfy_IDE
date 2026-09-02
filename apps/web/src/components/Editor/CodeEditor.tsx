import React, { useEffect, useRef, useState, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { FileNode, FileContentResult } from '@minfy/shared';
import { BinaryNotice } from './BinaryNotice.js';
import { Save, Code, Loader2, CheckCircle2 } from 'lucide-react';

interface CodeEditorProps {
  activeFile: FileNode | null;
  fileData: FileContentResult | null;
  loading: boolean;
  error: string | null;
  onSave: (path: string, content: string) => Promise<void>;
  onDirtyChange?: (isDirty: boolean, currentContent: string) => void;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  activeFile,
  fileData,
  loading,
  error,
  onSave,
  onDirtyChange,
}) => {
  const [content, setContent] = useState<string>('');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Sync content when active fileData changes
  useEffect(() => {
    if (fileData && fileData.content !== undefined) {
      setContent(fileData.content);
      setIsDirty(false);
      setSaveFeedback(null);
      onDirtyChange?.(false, fileData.content);
    }
  }, [fileData?.path, fileData?.content, onDirtyChange]);

  // Determine Monaco language
  const getLanguage = (ext?: string): string => {
    switch (ext?.toLowerCase()) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.json':
        return 'json';
      case '.html':
      case '.htm':
        return 'html';
      case '.css':
      case '.scss':
      case '.less':
        return 'css';
      case '.md':
      case '.markdown':
        return 'markdown';
      case '.py':
        return 'python';
      case '.rs':
        return 'rust';
      case '.go':
        return 'go';
      case '.sh':
      case '.bash':
      case '.zsh':
        return 'shell';
      case '.yml':
      case '.yaml':
        return 'yaml';
      case '.sql':
        return 'sql';
      case '.xml':
      case '.svg':
        return 'xml';
      default:
        return 'plaintext';
    }
  };

  const handleSave = useCallback(async () => {
    if (!activeFile || isSaving) return;
    try {
      setIsSaving(true);
      await onSave(activeFile.path, content);
      setIsDirty(false);
      onDirtyChange?.(false, content);
      setSaveFeedback('Saved');
      setTimeout(() => setSaveFeedback(null), 2500);
    } catch (err: any) {
      setSaveFeedback('Save Failed');
    } finally {
      setIsSaving(false);
    }
  }, [activeFile, content, isSaving, onSave, onDirtyChange]);

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;

    // Register Ctrl+S / Cmd+S save command inside Monaco
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      handleSave();
    });
  };

  // Global Ctrl+S listener fallback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (!activeFile) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          backgroundColor: 'var(--surface-1)',
          color: 'var(--text-muted)',
          gap: '12px',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: 'var(--surface-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Code size={24} color="var(--text-muted)" />
        </div>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
          Select a file from Explorer to start editing
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-disabled)' }}>
          Press <kbd style={{ padding: '2px 5px', borderRadius: '3px', background: 'var(--surface-3)', border: '1px solid var(--border-default)' }}>Ctrl + S</kbd> to save changes
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          backgroundColor: 'var(--surface-1)',
          color: 'var(--text-muted)',
          gap: '8px',
          fontSize: '13px',
        }}
      >
        <Loader2 size={16} className="animate-spin" color="var(--minfy-blue-primary)" />
        <span>Loading {activeFile.name}...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          backgroundColor: 'var(--surface-1)',
          color: 'var(--danger)',
          gap: '8px',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '14px' }}>Unable to open this file</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '400px' }}>
          {error}
        </div>
      </div>
    );
  }

  if (fileData?.isBinary || fileData?.truncated) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Tab Header */}
        <div
          style={{
            height: '34px',
            backgroundColor: 'var(--surface-2)',
            borderBottom: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
          }}
        >
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{activeFile.name}</span>
        </div>
        <div style={{ flex: 1 }}>
          <BinaryNotice
            filename={activeFile.name}
            isBinary={fileData.isBinary}
            size={fileData.size}
            truncated={fileData.truncated}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0 }}>
      {/* Editor Tab & Action Bar */}
      <div
        style={{
          height: '34px',
          backgroundColor: 'var(--surface-2)',
          borderBottom: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 0 0',
        }}
      >
        {/* Active Tab */}
        <div
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 16px',
            backgroundColor: 'var(--surface-1)',
            borderRight: '1px solid var(--border-subtle)',
            borderTop: '2px solid var(--minfy-blue-primary)',
            fontSize: '12px',
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          <span>{activeFile.name}</span>
          {isDirty && (
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: 'var(--minfy-yellow-accent)',
                display: 'inline-block',
              }}
              title="Unsaved changes"
            />
          )}
        </div>

        {/* Actions / Save Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saveFeedback && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                color: saveFeedback === 'Saved' ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {saveFeedback === 'Saved' && <CheckCircle2 size={12} />}
              <span>{saveFeedback}</span>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            style={{
              padding: '3px 10px',
              borderRadius: '4px',
              backgroundColor: isDirty ? 'var(--minfy-blue-primary)' : 'var(--surface-3)',
              color: isDirty ? '#ffffff' : 'var(--text-disabled)',
              fontSize: '11px',
              gap: '4px',
              fontWeight: 500,
            }}
            title="Save file (Ctrl + S)"
          >
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Monaco Editor Container */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Editor
          height="100%"
          language={getLanguage(activeFile.extension)}
          value={content}
          theme="vs-dark"
          onChange={(value) => {
            const nextVal = value || '';
            const nextDirty = nextVal !== fileData?.content;
            setContent(nextVal);
            setIsDirty(nextDirty);
            onDirtyChange?.(nextDirty, nextVal);
          }}
          onMount={handleEditorMount}
          options={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 20,
            minimap: { enabled: true, maxColumn: 80 },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            renderWhitespace: 'selection',
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            padding: { top: 10, bottom: 10 },
          }}
        />
      </div>
    </div>
  );
};
