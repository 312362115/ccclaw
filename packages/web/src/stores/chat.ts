import { create } from 'zustand';
import { sendMessage, sendConfirmResponse, onWsMessage, type WsIncoming } from '../api/ws';
import { api } from '../api/client';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'thinking' | 'system';
  content: string;
  toolName?: string;
  toolInput?: string;       // accumulates from tool_use_delta events
  toolOutput?: string;      // tool execution result from tool_result event
  toolId?: string;          // links tool_use_start → tool_use_delta/end/result
  isStreaming?: boolean;    // true while tool input is streaming
  confirmPending?: boolean; // true for confirm_request messages
  confirmRequestId?: string;
  confirmTool?: string;
  confirmReason?: string;
  timestamp: number;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Function type for sending messages over the direct channel */
export type DirectSendFn = (msg: unknown) => void;

interface ChatState {
  messages: Map<string, ChatMessage[]>; // sessionId → messages
  streamingMap: Map<string, boolean>;   // sessionId → streaming
  streamBufferMap: Map<string, string>; // sessionId → buffer
  streamErrorMap: Map<string, string>;  // sessionId → error
  currentSessionId: string | null;
  tokenUsage: Map<string, TokenUsage>; // sessionId → token usage

  // 按 sessionId 读取流式状态的便捷方法
  isStreaming: (sessionId: string) => boolean;
  getStreamBuffer: (sessionId: string) => string;
  getStreamError: (sessionId: string) => string | null;

  /** Direct-channel send function — set by useDirectConnection when DIRECT */
  directSend: DirectSendFn | null;
  setDirectSend: (fn: DirectSendFn | null) => void;

  setCurrentSession: (sessionId: string) => void;
  send: (workspaceId: string, sessionId: string, content: string) => void;
  loadMessages: (workspaceId: string, sessionId: string) => Promise<void>;
  getMessages: (sessionId: string) => ChatMessage[];
  initWsListener: () => () => void;

  // Tool streaming lifecycle
  onToolUseStart: (sessionId: string, toolId: string, name: string) => void;
  onToolUseDelta: (sessionId: string, toolId: string, input: string) => void;
  onToolUseEnd: (sessionId: string, toolId: string) => void;
  onToolResult: (sessionId: string, toolId: string, output: string) => void;

  // Thinking
  onThinkingDelta: (sessionId: string, content: string) => void;

  // Consolidation
  onConsolidation: (sessionId: string, message: string) => void;

  // Session done
  onSessionDone: (sessionId: string, tokens: TokenUsage) => void;

  // Confirm request
  onConfirmRequest: (sessionId: string, requestId: string, tool: string, input: unknown, reason: string) => void;

  // Confirm response (from user clicking Allow/Deny)
  resolveConfirm: (workspaceId: string, sessionId: string, requestId: string, approved: boolean) => void;
}

export const EMPTY_MESSAGES: ChatMessage[] = [];
let msgCounter = 0;
function nextId() { return `msg-${Date.now()}-${++msgCounter}`; }

/** Find the last message by toolId within a session's message list and return a new list with it updated. */
function updateMessageByToolId(
  msgs: ChatMessage[],
  toolId: string,
  updater: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
  // Walk from the end to find the most recent message with this toolId
  let idx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].toolId === toolId) { idx = i; break; }
  }
  if (idx === -1) return msgs;
  const next = [...msgs];
  next[idx] = updater(next[idx]);
  return next;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: new Map(),
  streamingMap: new Map(),
  streamBufferMap: new Map(),
  streamErrorMap: new Map(),
  currentSessionId: null,
  tokenUsage: new Map(),
  directSend: null,

  isStreaming: (sessionId) => get().streamingMap.get(sessionId) ?? false,
  getStreamBuffer: (sessionId) => get().streamBufferMap.get(sessionId) ?? '',
  getStreamError: (sessionId) => get().streamErrorMap.get(sessionId) ?? null,

  setDirectSend: (fn) => set({ directSend: fn }),

  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  loadMessages: async (workspaceId, sessionId) => {
    // 已加载过则跳过
    if (get().messages.has(sessionId)) return;
    try {
      const rows = await api<Array<{ id: string; role: string; content: string; created_at: string }>>(
        `/workspaces/${workspaceId}/sessions/${sessionId}/messages`,
      );
      if (rows.length === 0) return;
      const msgs: ChatMessage[] = rows.map((r) => ({
        id: r.id,
        role: (r.role === 'tool' ? 'tool' : r.role === 'user' ? 'user' : 'assistant') as ChatMessage['role'],
        content: r.content,
        timestamp: new Date(r.created_at).getTime(),
      }));
      const newMap = new Map(get().messages);
      newMap.set(sessionId, msgs);
      set({ messages: newMap });
    } catch (e) {
      // 404 is expected for new sessions without history
      if (e instanceof Error && 'status' in e && (e as any).status === 404) return;
      console.warn('加载历史消息失败:', e);
    }
  },

  send: (workspaceId, sessionId, content) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    msgs.push({ id: nextId(), role: 'user', content, timestamp: Date.now() });
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    const newStreamingMap = new Map(state.streamingMap);
    newStreamingMap.set(sessionId, true);
    const newBufferMap = new Map(state.streamBufferMap);
    newBufferMap.set(sessionId, '');
    const newErrorMap = new Map(state.streamErrorMap);
    newErrorMap.delete(sessionId);
    set({ messages: newMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap, streamErrorMap: newErrorMap });

    if (state.directSend) {
      // Send via direct encrypted channel
      state.directSend({
        channel: 'chat',
        action: 'message',
        requestId: `chat-${Date.now()}`,
        data: { sessionId, message: content },
      });
    } else {
      // Fallback to Server WS relay
      sendMessage(workspaceId, sessionId, content);
    }
  },

  getMessages: (sessionId) => get().messages.get(sessionId) || EMPTY_MESSAGES,

  // ── Tool streaming lifecycle ──────────────────────────────────────────────

  onToolUseStart: (sessionId, toolId, name) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    msgs.push({
      id: nextId(),
      role: 'tool',
      content: `调用工具: ${name}`,
      toolName: name,
      toolId,
      toolInput: '',
      isStreaming: true,
      timestamp: Date.now(),
    });
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  onToolUseDelta: (sessionId, toolId, input) => {
    const state = get();
    const msgs = updateMessageByToolId(
      state.messages.get(sessionId) || [],
      toolId,
      (m) => ({ ...m, toolInput: (m.toolInput ?? '') + input }),
    );
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  onToolUseEnd: (sessionId, toolId) => {
    const state = get();
    const msgs = updateMessageByToolId(
      state.messages.get(sessionId) || [],
      toolId,
      (m) => ({ ...m, isStreaming: false }),
    );
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  onToolResult: (sessionId, toolId, output) => {
    const state = get();
    const msgs = updateMessageByToolId(
      state.messages.get(sessionId) || [],
      toolId,
      (m) => ({ ...m, toolOutput: output, isStreaming: false }),
    );
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  // ── Thinking ─────────────────────────────────────────────────────────────

  onThinkingDelta: (sessionId, content) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'thinking') {
      // Append to existing thinking message
      msgs[msgs.length - 1] = { ...last, content: last.content + content };
    } else {
      msgs.push({ id: nextId(), role: 'thinking', content, timestamp: Date.now() });
    }
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  // ── Consolidation ─────────────────────────────────────────────────────────

  onConsolidation: (sessionId, message) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    msgs.push({ id: nextId(), role: 'system', content: message, timestamp: Date.now() });
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  // ── Session done ──────────────────────────────────────────────────────────

  onSessionDone: (sessionId, tokens) => {
    const state = get();
    const buffer = state.streamBufferMap.get(sessionId) ?? '';
    const msgs = [...(state.messages.get(sessionId) || [])];
    if (buffer) {
      msgs.push({ id: nextId(), role: 'assistant', content: buffer, timestamp: Date.now() });
    }
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    const newTokenMap = new Map(state.tokenUsage);
    newTokenMap.set(sessionId, tokens);
    const newStreamingMap = new Map(state.streamingMap);
    newStreamingMap.set(sessionId, false);
    const newBufferMap = new Map(state.streamBufferMap);
    newBufferMap.set(sessionId, '');
    set({ messages: newMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap, tokenUsage: newTokenMap });
  },

  // ── Confirm request ──────────────────────────────────────────────────────

  onConfirmRequest: (sessionId, requestId, tool, input, reason) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    msgs.push({
      id: nextId(),
      role: 'tool',
      content: `需要确认: ${tool}`,
      toolName: tool,
      toolInput: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
      confirmPending: true,
      confirmRequestId: requestId,
      confirmTool: tool,
      confirmReason: reason,
      timestamp: Date.now(),
    });
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  // ── Confirm response ──────────────────────────────────────────────────────

  resolveConfirm: (workspaceId, sessionId, requestId, approved) => {
    const state = get();
    const msgs = (state.messages.get(sessionId) || []).map((m) => {
      if (m.confirmRequestId === requestId && m.confirmPending) {
        return {
          ...m,
          confirmPending: false,
          content: approved ? '✓ 已允许' : '✗ 已拒绝',
        };
      }
      return m;
    });
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });

    if (state.directSend) {
      state.directSend({
        channel: 'chat',
        action: 'confirm_response',
        data: { requestId, approved },
      });
    } else {
      sendConfirmResponse(workspaceId, sessionId, requestId, approved);
    }
  },

  // ── WebSocket listener ────────────────────────────────────────────────────

  initWsListener: () => {
    return onWsMessage((msg: WsIncoming) => {
      const sessionId = msg.sessionId;
      if (!sessionId) return;

      const state = get();

      if (msg.type === 'text_delta') {
        const text = msg.content || msg.text || '';
        const newBufferMap = new Map(state.streamBufferMap);
        newBufferMap.set(sessionId, (newBufferMap.get(sessionId) ?? '') + text);
        set({ streamBufferMap: newBufferMap });
        return;
      }

      // ── New tool streaming events ────────────────────────────────────────
      if (msg.type === 'tool_use_start') {
        get().onToolUseStart(sessionId, msg.toolId!, msg.name!);
        return;
      }

      if (msg.type === 'tool_use_delta') {
        get().onToolUseDelta(sessionId, msg.toolId!, (msg.input as string) ?? '');
        return;
      }

      if (msg.type === 'tool_use_end') {
        get().onToolUseEnd(sessionId, msg.toolId!);
        return;
      }

      if (msg.type === 'tool_result') {
        get().onToolResult(sessionId, msg.toolId!, msg.output ?? '');
        return;
      }

      // ── Thinking ─────────────────────────────────────────────────────────
      if (msg.type === 'thinking_delta') {
        get().onThinkingDelta(sessionId, msg.content ?? '');
        return;
      }

      // ── Consolidation ────────────────────────────────────────────────────
      if (msg.type === 'consolidation') {
        get().onConsolidation(sessionId, msg.message ?? '');
        return;
      }

      // ── Sub-agent events (dispatched to handlers; store just persists as system messages) ──
      if (msg.type === 'subagent_started') {
        get().onConsolidation(sessionId, `[子 Agent 启动] ${msg.label ?? msg.taskId}`);
        return;
      }

      if (msg.type === 'subagent_result') {
        get().onConsolidation(sessionId, `[子 Agent 完成] ${msg.taskId}: ${msg.output ?? ''}`);
        return;
      }

      // ── Legacy tool_use (fallback: map to tool_use_start + immediate end) ──
      if (msg.type === 'tool_use') {
        const legacyId = `legacy-${nextId()}`;
        get().onToolUseStart(sessionId, legacyId, msg.tool ?? 'unknown');
        if (msg.input !== undefined) {
          get().onToolUseDelta(
            sessionId,
            legacyId,
            typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input, null, 2),
          );
        }
        get().onToolUseEnd(sessionId, legacyId);
        return;
      }

      // ── session_done (new) ───────────────────────────────────────────────
      if (msg.type === 'session_done') {
        const rawTokens = msg.tokens;
        const tokens: TokenUsage =
          rawTokens && typeof rawTokens === 'object'
            ? (rawTokens as TokenUsage)
            : { inputTokens: 0, outputTokens: typeof rawTokens === 'number' ? rawTokens : 0 };
        get().onSessionDone(sessionId, tokens);
        return;
      }

      // ── done (legacy, maps to session_done behavior) ─────────────────────
      if (msg.type === 'done') {
        const rawTokens = msg.tokens;
        const tokens: TokenUsage =
          rawTokens && typeof rawTokens === 'object'
            ? (rawTokens as TokenUsage)
            : { inputTokens: 0, outputTokens: typeof rawTokens === 'number' ? rawTokens : 0 };
        get().onSessionDone(sessionId, tokens);
        return;
      }

      // ── confirm_request ──────────────────────────────────────────────────
      if (msg.type === 'confirm_request') {
        get().onConfirmRequest(
          sessionId,
          msg.requestId ?? '',
          msg.tool ?? '',
          msg.input,
          msg.reason ?? '',
        );
        return;
      }

      // ── error — 不新增消息，更新到 streamError 显示在气泡里 ──
      if (msg.type === 'error') {
        const newErrorMap = new Map(state.streamErrorMap);
        newErrorMap.set(sessionId, msg.message || '未知错误');
        const newStreamingMap = new Map(state.streamingMap);
        newStreamingMap.set(sessionId, false);
        const newBufferMap = new Map(state.streamBufferMap);
        newBufferMap.set(sessionId, '');
        set({ streamErrorMap: newErrorMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap });
      }
    });
  },
}));
