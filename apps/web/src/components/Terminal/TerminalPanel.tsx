import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { TerminalClientMessage, TerminalServerMessage } from '@minfy/shared';
import { RotateCw, X, Maximize2, Minimize2, Terminal as TermIcon } from 'lucide-react';

interface TerminalPanelProps {
  workspaceId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ workspaceId, isOpen, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [connected, setConnected] = useState<boolean>(false);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  const connectWebSocket = useCallback(() => {
    if (!workspaceId) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const term = termRef.current;
    if (!term) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // If running in vite dev port 5173, runtime ws is on 4560 (or proxied)
    const wsUrl = `${protocol}//${host}/ws/terminal?workspaceId=${workspaceId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.focus();
    };

    ws.onmessage = (event) => {
      try {
        const msg: TerminalServerMessage = JSON.parse(event.data);
        if (msg.type === 'output' && msg.data) {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
          setConnected(false);
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31m[Terminal Error: ${msg.error}]\x1b[0m\r\n`);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
    };
  }, [workspaceId]);

  const handleRestart = () => {
    if (termRef.current) {
      termRef.current.reset();
    }
    connectWebSocket();
  };

  useEffect(() => {
    if (!isOpen || !containerRef.current || !workspaceId) return;

    // Initialize xterm if not already created
    if (!termRef.current) {
      const term = new Terminal({
        theme: {
          background: '#090d13',
          foreground: '#f0f6fc',
          cursor: '#facc15',
          cursorAccent: '#000000',
          selectionBackground: 'rgba(37, 99, 235, 0.4)',
          black: '#090d13',
          red: '#f85149',
          green: '#3fb950',
          yellow: '#facc15',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
        },
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.3,
        cursorBlink: true,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      term.onData((data) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const msg: TerminalClientMessage = { type: 'input', data };
          wsRef.current.send(JSON.stringify(msg));
        }
      });

      setTimeout(() => fitAddon.fit(), 50);
    }

    connectWebSocket();

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isOpen, workspaceId, connectWebSocket]);

  useEffect(() => {
    if (isOpen && fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore
        }
      }, 100);
    }
  }, [isOpen, isMaximized]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        height: isMaximized ? 'calc(100vh - var(--header-height))' : 'var(--panel-terminal-height)',
        backgroundColor: '#090d13',
        borderTop: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        position: isMaximized ? 'absolute' : 'relative',
        bottom: 0,
        left: 0,
        right: 0,
      }}
    >
      {/* Terminal Header */}
      <div
        style={{
          height: '28px',
          backgroundColor: 'var(--surface-2)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
          <TermIcon size={13} color="var(--minfy-blue-primary)" />
          <span style={{ color: 'var(--text-secondary)' }}>TERMINAL</span>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: connected ? 'var(--success)' : 'var(--danger)',
              marginLeft: '4px',
            }}
            title={connected ? 'Terminal connected' : 'Terminal disconnected'}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={handleRestart}
            title="Restart Terminal Session"
            style={{ padding: '2px 6px', borderRadius: '3px', color: 'var(--text-muted)' }}
          >
            <RotateCw size={12} />
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? 'Restore Terminal' : 'Maximize Terminal'}
            style={{ padding: '2px 6px', borderRadius: '3px', color: 'var(--text-muted)' }}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={onClose}
            title="Close Terminal"
            style={{ padding: '2px 6px', borderRadius: '3px', color: 'var(--text-muted)' }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          padding: '6px 8px',
          overflow: 'hidden',
          backgroundColor: '#090d13',
        }}
      />
    </div>
  );
};
