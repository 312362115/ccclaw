/**
 * MessageBus 事件类型定义
 *
 * InboundMessage: 从渠道（WebUI/Telegram/…）到 AgentManager
 * OutboundMessage: 从 AgentManager 到渠道
 */

// ====== Inbound（渠道 → AgentManager） ======

export interface InboundUserMessage {
  type: 'user_message';
  workspaceId: string;
  sessionId: string;
  userId: string;
  channelType: string;
  content: string;
}

export interface InboundCancelMessage {
  type: 'cancel';
  workspaceId: string;
  sessionId: string;
}

export interface InboundConfirmResponse {
  type: 'confirm_response';
  workspaceId: string;
  sessionId: string;
  requestId: string;
  approved: boolean;
}

export type InboundMessage =
  | InboundUserMessage
  | InboundCancelMessage
  | InboundConfirmResponse;

// ====== Outbound（AgentManager → 渠道） ======

export interface OutboundTextDelta {
  type: 'text_delta';
  sessionId: string;
  content: string;
}

export interface OutboundToolUse {
  type: 'tool_use';
  sessionId: string;
  tool: string;
  input: unknown;
}

export interface OutboundToolResult {
  type: 'tool_result';
  sessionId: string;
  tool: string;
  output: string;
}

export interface OutboundConfirmRequest {
  type: 'confirm_request';
  sessionId: string;
  requestId: string;
  tool: string;
  input: unknown;
  reason: string;
}

export interface OutboundDone {
  type: 'done';
  sessionId: string;
  tokens: number;
}

export interface OutboundError {
  type: 'error';
  sessionId: string;
  message: string;
}

export type OutboundMessage =
  | OutboundTextDelta
  | OutboundToolUse
  | OutboundToolResult
  | OutboundConfirmRequest
  | OutboundDone
  | OutboundError;
