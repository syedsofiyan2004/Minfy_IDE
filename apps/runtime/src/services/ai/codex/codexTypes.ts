/**
 * Typed subset of OpenAI Codex App Server v2 protocol DTOs.
 * Sourced directly from official Codex CLI app-server protocol schema.
 */

export interface CodexClientInfo {
  name: string;
  title: string | null;
  version: string;
}

export interface CodexInitializeParams {
  clientInfo: CodexClientInfo;
  capabilities: Record<string, unknown> | null;
}

export interface CodexInitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export type CodexPlanType =
  | 'free'
  | 'plus'
  | 'team'
  | 'enterprise'
  | 'edu'
  | 'pro'
  | 'unknown';

export interface CodexChatGptAccount {
  type: 'chatgpt';
  email: string | null;
  planType: CodexPlanType;
}

export interface CodexApiKeyAccount {
  type: 'apiKey';
}

export type CodexAccount = CodexChatGptAccount | CodexApiKeyAccount | { type: string; [key: string]: unknown };

export interface CodexGetAccountResponse {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
}

export interface CodexLoginAccountParams {
  type: 'chatgpt';
  codexStreamlinedLogin?: boolean;
  useHostedLoginSuccessPage?: boolean;
}

export interface CodexLoginAccountResponse {
  type: 'chatgpt';
  loginId: string;
  authUrl: string;
}

export interface CodexCancelLoginAccountParams {
  loginId: string;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  inputModalities?: string[];
}

export interface CodexModelListResponse {
  data: CodexModel[];
  nextCursor: string | null;
}

export interface CodexThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  approvalPolicy?: 'never' | 'on-request' | 'untrusted' | null;
  ephemeral?: boolean | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
}

export interface CodexThread {
  id: string;
  status?: string;
  createdAt?: number;
}

export interface CodexThreadStartResponse {
  thread: CodexThread;
  model: string;
  cwd: string;
}

export interface CodexUserInputText {
  type: 'text';
  text: string;
  text_elements?: Array<{ [key: string]: unknown }>;
}

export interface CodexTurnStartParams {
  threadId: string;
  input: CodexUserInputText[];
  cwd?: string | null;
  model?: string | null;
}

export interface CodexTurnError {
  message: string;
  additionalDetails?: string | null;
}

export interface CodexTurn {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: CodexTurnError | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface CodexTurnStartResponse {
  turn: CodexTurn;
}

export interface CodexTurnInterruptParams {
  threadId: string;
  turnId: string;
}

// Server -> Client Notifications
export interface CodexAgentMessageDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface CodexTurnCompletedParams {
  threadId: string;
  turn: CodexTurn;
}

export interface CodexAccountLoginCompletedParams {
  loginId: string | null;
  success: boolean;
  error: string | null;
}

export interface CodexTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface CodexThreadTokenUsage {
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface CodexThreadTokenUsageUpdatedParams {
  threadId: string;
  turnId: string;
  tokenUsage: CodexThreadTokenUsage;
}

// Protocol Message envelopes
export interface CodexRpcRequest {
  id: string;
  method: string;
  params?: unknown;
}

export interface CodexRpcResponse {
  id: string;
  result?: unknown;
  error?: {
    code?: number;
    message: string;
    data?: unknown;
  };
}

export interface CodexRpcNotification {
  method: string;
  params?: unknown;
  emittedAtMs?: number;
}

export interface CodexServerInitiatedRequest {
  id: string;
  method: string;
  params?: unknown;
}
