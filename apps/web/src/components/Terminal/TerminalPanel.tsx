import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { TerminalClientMessage, TerminalServerMessage } from '@minfy/shared';
import { RotateCw, X, Maximize2, Minimize2, Terminal as TermIcon } from 'lucide-react';
import { api } from '../../api/client.js';

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

  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
      const msg: TerminalClientMessage = { type: 'resize', cols, rows };
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connectWebSocket = useCallback(async () => {
    if (!workspaceId) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const term = termRef.current;
    if (!term) return;

    try {
      // 1. Obtain single-use short-lived terminal ticket via authenticated HTTP
      const { ticket } = await api.createTerminalTicket(workspaceId);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/terminal?ticket=${encodeURIComponent(ticket)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        term.focus();
        try {
          fitAddonRef.current?.fit();
          sendResize(term.cols, term.rows);
        } catch {
          // ignore
        }
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
    } catch (err: any) {
      term.write(`\r\n\x1b[31m[Terminal Auth Error: ${err.message || 'Failed to acquire authorization ticket'}]\x1b[0m\r\n`);
      setConnected(false);
    }
  }, [workspaceId, sendResize]);

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
    }

    connectWebSocket();

    const doFitAndResize = () => {
      try {
        if (fitAddonRef.current && termRef.current) {
          fitAddonRef.current.fit();
          sendResize(termRef.current.cols, termRef.current.rows);
        }
      } catch {
        // ignore
      }
    };

    // Use ResizeObserver for accurate sizing on layout shifts
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        doFitAndResize();
      });
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', doFitAndResize);

    return () => {
      window.removeEventListener('resize', doFitAndResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isOpen, workspaceId, connectWebSocket, sendResize]);

  useEffect(() => {
    if (isOpen && fitAddonRef.current && termRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (termRef.current) {
            sendResize(termRef.current.cols, termRef.current.rows);
          }
        } catch {
          // ignore
        }
      }, 80);
    }
  }, [isOpen, isMaximized, sendResize]);

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
          padding: '0 10px',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: 600 }}>
          <TermIcon size={13} color="var(--minfy-blue-primary)" />
          <span style={{ color: 'var(--text-secondary)' }}>TERMINAL</span>
          <span
            style={{
              padding: '1px 5px',
              borderRadius: '3px',
              backgroundColor: 'var(--surface-3)',
              color: 'var(--text-muted)',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            PowerShell
          </span>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: connected ? 'var(--success)' : 'var(--danger)',
              boxShadow: connected ? '0 0 6px rgba(63, 185, 80, 0.6)' : 'none',
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
          padding: '4px 6px',
          overflow: 'hidden',
          backgroundColor: '#090d13',
        }}
      />
    </div>
  );
};
