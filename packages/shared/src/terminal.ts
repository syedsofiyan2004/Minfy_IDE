export type TerminalClientMessageType = 'input' | 'resize' | 'ping';
export type TerminalServerMessageType = 'output' | 'exit' | 'error' | 'pong';

export interface TerminalClientMessage {
  type: TerminalClientMessageType;
  data?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalServerMessage {
  type: TerminalServerMessageType;
  data?: string;
  exitCode?: number;
  error?: string;
}

export interface TerminalTicketResponse {
  ticket: string;
  expiresAt: number;
}
