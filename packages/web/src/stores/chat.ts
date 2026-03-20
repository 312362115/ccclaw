import { create } from 'zustand';
import { sendMessage, sendConfirmResponse, onWsMessage, type WsIncoming } from '../api/ws';
import { api } from '../api/client';

// ====== Types ======

export interface ToolCallInfo {
  id: string;
  name: string;
  input: string;         // 工具输入（JSON 字符串，流式累积）
  output: string;        // 工具输出
  hookOutput?: string;   // Hook 输出
  status: 'running' | 'success' | 'error';
  expanded: boolean;     // 是否展开详情
}

export interface ImageInfo {
  data: string;          // base64
  mediaType: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thinking' | 'system';
  content: string;
  toolCalls?: ToolCallInfo[];   // AI 消息可包含多个工具调用
  images?: ImageInfo[];          // 消息附带的图片
  planMode?: boolean;            // Plan 模式输出
  // Confirm（仍保留，作为独立的 system 级消息）
  confirmPending?: boolean;
  confirmRequestId?: string;
  confirmTool?: string;
  confirmInput?: string;
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
  messages: Map<string, ChatMessage[]>;
  streamingMap: Map<string, boolean>;
  streamBufferMap: Map<string, string>;
  streamErrorMap: Map<string, string>;
  planModeMap: Map<string, boolean>;   // sessionId → 是否在 plan 模式
  pendingImages: Map<string, ImageInfo[]>; // sessionId → 待发送的图片
  currentSessionId: string | null;
  tokenUsage: Map<string, TokenUsage>;

  isStreaming: (sessionId: string) => boolean;
  getStreamBuffer: (sessionId: string) => string;
  getStreamError: (sessionId: string) => string | null;
  isPlanMode: (sessionId: string) => boolean;
  getPendingImages: (sessionId: string) => ImageInfo[];

  directSend: DirectSendFn | null;
  setDirectSend: (fn: DirectSendFn | null) => void;

  setCurrentSession: (sessionId: string) => void;
  send: (workspaceId: string, sessionId: string, content: string) => void;
  sendWithImages: (workspaceId: string, sessionId: string, content: string, images: ImageInfo[]) => void;
  addPendingImage: (sessionId: string, image: ImageInfo) => void;
  removePendingImage: (sessionId: string, index: number) => void;
  clearPendingImages: (sessionId: string) => void;
  loadMessages: (workspaceId: string, sessionId: string) => Promise<void>;
  getMessages: (sessionId: string) => ChatMessage[];
  toggleToolExpanded: (sessionId: string, messageId: string, toolId: string) => void;
  initWsListener: () => () => void;

  // Tool streaming lifecycle (工具调用合并到 AI 消息)
  onToolUseStart: (sessionId: string, toolId: string, name: string) => void;
  onToolUseDelta: (sessionId: string, toolId: string, input: string) => void;
  onToolUseEnd: (sessionId: string, toolId: string) => void;
  onToolResult: (sessionId: string, toolId: string, output: string) => void;

  onThinkingDelta: (sessionId: string, content: string) => void;
  onConsolidation: (sessionId: string, message: string) => void;
  onSessionDone: (sessionId: string, tokens: TokenUsage) => void;
  onPlanMode: (sessionId: string, active: boolean) => void;
  onConfirmRequest: (sessionId: string, requestId: string, tool: string, input: unknown, reason: string) => void;
  resolveConfirm: (workspaceId: string, sessionId: string, requestId: string, approved: boolean) => void;
}

// ====== Helpers ======

export const EMPTY_MESSAGES: ChatMessage[] = [];
let msgCounter = 0;
function nextId() { return `msg-${Date.now()}-${++msgCounter}`; }

/** 获取或创建当前 AI 回合的 assistant 消息（工具调用合并到这条消息里） */
function getOrCreateAssistantMsg(msgs: ChatMessage[]): { msgs: ChatMessage[]; assistantIdx: number } {
  // 找最后一条 assistant 消息（必须是最后一条或倒数第二条，中间可能有 thinking）
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') {
      return { msgs: [...msgs], assistantIdx: i };
    }
    // 跨过 thinking/system 消息继续找
    if (msgs[i].role === 'thinking' || msgs[i].role === 'system') continue;
    break; // 遇到 user 消息就停
  }
  // 没找到，创建一条空的 assistant 消息
  const newMsgs = [...msgs, { id: nextId(), role: 'assistant' as const, content: '', toolCalls: [], timestamp: Date.now() }];
  return { msgs: newMsgs, assistantIdx: newMsgs.length - 1 };
}

/** 更新 assistant 消息中指定 toolCall */
function updateToolCall(
  msg: ChatMessage,
  toolId: string,
  updater: (tc: ToolCallInfo) => ToolCallInfo,
): ChatMessage {
  if (!msg.toolCalls) return msg;
  const newCalls = msg.toolCalls.map((tc) => tc.id === toolId ? updater(tc) : tc);
  return { ...msg, toolCalls: newCalls };
}

/** 从工具输出中提取摘要 */
export function extractToolSummary(name: string, input: string, output: string): string {
  try {
    const inp = input ? JSON.parse(input) : {};
    switch (name) {
      case 'read': {
        const path = inp.file_path || inp.path || '';
        const shortPath = path.split('/').slice(-2).join('/');
        return shortPath;
      }
      case 'edit': {
        const path = inp.file_path || inp.path || '';
        const shortPath = path.split('/').slice(-2).join('/');
        return `${shortPath}`;
      }
      case 'write': {
        const path = inp.file_path || inp.path || '';
        const shortPath = path.split('/').slice(-2).join('/');
        const isNew = output.includes('created') || output.includes('新建');
        return `${shortPath}${isNew ? ' (新建)' : ''}`;
      }
      case 'bash': {
        const cmd = (inp.command || '').slice(0, 60);
        // 从输出尾部提取摘要（如测试结果、exit code）
        const lines = output.trim().split('\n').filter(Boolean);
        const lastLine = lines[lines.length - 1] || '';
        const brief = lastLine.length > 40 ? lastLine.slice(0, 40) + '…' : lastLine;
        return cmd + (brief ? ` → ${brief}` : '');
      }
      case 'glob': return inp.pattern || '';
      case 'grep': return inp.pattern || '';
      case 'git': return (inp.command || '').slice(0, 60);
      default: return '';
    }
  } catch {
    return '';
  }
}

/** 工具名对应的图标 */
export function toolIcon(name: string): string {
  switch (name) {
    case 'read': return '📄';
    case 'edit': return '✏️';
    case 'write': return '📝';
    case 'bash': return '⚡';
    case 'git': return '⚡';
    case 'glob': return '🔍';
    case 'grep': return '🔍';
    case 'web_fetch': return '🌐';
    case 'memory_write': case 'memory_read': case 'memory_search': return '🧠';
    case 'todo_read': case 'todo_write': return '📋';
    case 'spawn': return '🤖';
    default: return '🔧';
  }
}

// ====== Store ======

export const useChatStore = create<ChatState>((set, get) => ({
  messages: new Map(),
  streamingMap: new Map(),
  streamBufferMap: new Map(),
  streamErrorMap: new Map(),
  planModeMap: new Map(),
  pendingImages: new Map(),
  currentSessionId: null,
  tokenUsage: new Map(),
  directSend: null,

  isStreaming: (sessionId) => get().streamingMap.get(sessionId) ?? false,
  getStreamBuffer: (sessionId) => get().streamBufferMap.get(sessionId) ?? '',
  getStreamError: (sessionId) => get().streamErrorMap.get(sessionId) ?? null,
  isPlanMode: (sessionId) => get().planModeMap.get(sessionId) ?? false,
  getPendingImages: (sessionId) => get().pendingImages.get(sessionId) ?? [],

  setDirectSend: (fn) => set({ directSend: fn }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  loadMessages: async (workspaceId, sessionId) => {
    if (get().messages.has(sessionId)) return;
    try {
      const rows = await api<Array<{ id: string; role: string; content: string; tool_calls?: string; created_at: string }>>(
        `/workspaces/${workspaceId}/sessions/${sessionId}/messages`,
      );
      if (rows.length === 0) return;
      // 历史消息：tool 角色的消息合并到前一个 assistant 消息
      const msgs: ChatMessage[] = [];
      for (const r of rows) {
        if (r.role === 'tool') {
          // 找最后一个 assistant 消息，把 tool 结果追加为 toolCall
          const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
          if (lastAssistant) {
            if (!lastAssistant.toolCalls) lastAssistant.toolCalls = [];
            let toolName = 'unknown';
            try {
              const tc = JSON.parse(r.tool_calls || '{}');
              toolName = tc.name || 'unknown';
            } catch { /* ignore */ }
            lastAssistant.toolCalls.push({
              id: r.id,
              name: toolName,
              input: '',
              output: r.content,
              status: r.content.startsWith('Error:') ? 'error' : 'success',
              expanded: false,
            });
          }
        } else {
          msgs.push({
            id: r.id,
            role: (r.role === 'user' ? 'user' : 'assistant') as ChatMessage['role'],
            content: r.content,
            timestamp: new Date(r.created_at).getTime(),
          });
        }
      }
      const newMap = new Map(get().messages);
      newMap.set(sessionId, msgs);
      set({ messages: newMap });
    } catch (e) {
      if (e instanceof Error && 'status' in e && (e as any).status === 404) return;
      console.warn('加载历史消息失败:', e);
    }
  },

  send: (workspaceId, sessionId, content) => {
    get().sendWithImages(workspaceId, sessionId, content, []);
  },

  sendWithImages: (workspaceId, sessionId, content, images) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content, timestamp: Date.now() };
    if (images.length > 0) userMsg.images = images;
    msgs.push(userMsg);
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    const newStreamingMap = new Map(state.streamingMap);
    newStreamingMap.set(sessionId, true);
    const newBufferMap = new Map(state.streamBufferMap);
    newBufferMap.set(sessionId, '');
    const newErrorMap = new Map(state.streamErrorMap);
    newErrorMap.delete(sessionId);
    // 清空待发送图片
    const newPendingImages = new Map(state.pendingImages);
    newPendingImages.delete(sessionId);
    set({ messages: newMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap, streamErrorMap: newErrorMap, pendingImages: newPendingImages });

    // 构建 content blocks（图片时）
    const contentBlocks = images.length > 0
      ? images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType as any, data: img.data } }))
      : undefined;

    if (state.directSend) {
      state.directSend({
        channel: 'chat',
        action: 'message',
        requestId: `chat-${Date.now()}`,
        data: { sessionId, message: content, ...(contentBlocks ? { content: contentBlocks } : {}) },
      });
    } else {
      sendMessage(workspaceId, sessionId, content);
    }
  },

  addPendingImage: (sessionId, image) => {
    const state = get();
    const current = state.pendingImages.get(sessionId) || [];
    const newPending = new Map(state.pendingImages);
    newPending.set(sessionId, [...current, image]);
    set({ pendingImages: newPending });
  },

  removePendingImage: (sessionId, index) => {
    const state = get();
    const current = [...(state.pendingImages.get(sessionId) || [])];
    current.splice(index, 1);
    const newPending = new Map(state.pendingImages);
    newPending.set(sessionId, current);
    set({ pendingImages: newPending });
  },

  clearPendingImages: (sessionId) => {
    const newPending = new Map(get().pendingImages);
    newPending.delete(sessionId);
    set({ pendingImages: newPending });
  },

  getMessages: (sessionId) => get().messages.get(sessionId) || EMPTY_MESSAGES,

  toggleToolExpanded: (sessionId, messageId, toolId) => {
    const state = get();
    const msgs = (state.messages.get(sessionId) || []).map((m) => {
      if (m.id !== messageId || !m.toolCalls) return m;
      return {
        ...m,
        toolCalls: m.toolCalls.map((tc) =>
          tc.id === toolId ? { ...tc, expanded: !tc.expanded } : tc,
        ),
      };
    });
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  // ── Tool streaming lifecycle — 合并到 AI 消息 ─────────────────────────────

  onToolUseStart: (sessionId, toolId, name) => {
    const state = get();
    // 先把 buffer 刷到 assistant 消息（如果有内容的话）
    const buffer = state.streamBufferMap.get(sessionId) ?? '';
    let rawMsgs = [...(state.messages.get(sessionId) || [])];
    if (buffer) {
      const { msgs: withAssistant, assistantIdx } = getOrCreateAssistantMsg(rawMsgs);
      withAssistant[assistantIdx] = { ...withAssistant[assistantIdx], content: withAssistant[assistantIdx].content + buffer };
      rawMsgs = withAssistant;
    }
    // 获取当前 assistant 消息，追加 toolCall
    const { msgs, assistantIdx } = getOrCreateAssistantMsg(rawMsgs);
    const assistantMsg = msgs[assistantIdx];
    const toolCalls = [...(assistantMsg.toolCalls || [])];
    toolCalls.push({ id: toolId, name, input: '', output: '', status: 'running', expanded: false });
    msgs[assistantIdx] = { ...assistantMsg, toolCalls };

    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    const newBufferMap = new Map(state.streamBufferMap);
    newBufferMap.set(sessionId, '');
    set({ messages: newMap, streamBufferMap: newBufferMap });
  },

  onToolUseDelta: (sessionId, toolId, input) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    // 找最后一个有此 toolId 的 assistant 消息
    for (let i = msgs.length - 1; i >= 0; i--) {
      const tc = msgs[i].toolCalls?.find((t) => t.id === toolId);
      if (tc) {
        msgs[i] = updateToolCall(msgs[i], toolId, (t) => ({ ...t, input: t.input + input }));
        break;
      }
    }
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });
  },

  onToolUseEnd: (sessionId, toolId) => {
    // input 流完成，状态不变（等 tool_result 来决定 success/error）
  },

  onToolResult: (sessionId, toolId, output) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const tc = msgs[i].toolCalls?.find((t) => t.id === toolId);
      if (tc) {
        const isError = output.startsWith('Error:');
        // 提取 hook 输出
        let mainOutput = output;
        let hookOutput: string | undefined;
        const hookIdx = output.indexOf('\n[Hook]');
        if (hookIdx !== -1) {
          mainOutput = output.slice(0, hookIdx);
          hookOutput = output.slice(hookIdx + 8); // skip '\n[Hook] '
        }
        msgs[i] = updateToolCall(msgs[i], toolId, (t) => ({
          ...t,
          output: mainOutput,
          hookOutput,
          status: isError ? 'error' : 'success',
          expanded: isError, // 错误自动展开
        }));
        break;
      }
    }
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

  // ── Plan mode ─────────────────────────────────────────────────────────────

  onPlanMode: (sessionId, active) => {
    const newPlanMap = new Map(get().planModeMap);
    newPlanMap.set(sessionId, active);
    set({ planModeMap: newPlanMap });
  },

  // ── Session done ──────────────────────────────────────────────────────────

  onSessionDone: (sessionId, tokens) => {
    const state = get();
    const buffer = state.streamBufferMap.get(sessionId) ?? '';
    const msgs = [...(state.messages.get(sessionId) || [])];

    if (buffer) {
      // 把 buffer 刷到最后一个 assistant 消息或新建一个
      const { msgs: withAssistant, assistantIdx } = getOrCreateAssistantMsg(msgs);
      withAssistant[assistantIdx] = {
        ...withAssistant[assistantIdx],
        content: withAssistant[assistantIdx].content + buffer,
        planMode: state.planModeMap.get(sessionId) ?? false,
      };
      const newMap = new Map(state.messages);
      newMap.set(sessionId, withAssistant);
      const newTokenMap = new Map(state.tokenUsage);
      newTokenMap.set(sessionId, tokens);
      const newStreamingMap = new Map(state.streamingMap);
      newStreamingMap.set(sessionId, false);
      const newBufferMap = new Map(state.streamBufferMap);
      newBufferMap.set(sessionId, '');
      set({ messages: newMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap, tokenUsage: newTokenMap });
    } else {
      const newMap = new Map(state.messages);
      newMap.set(sessionId, msgs);
      const newTokenMap = new Map(state.tokenUsage);
      newTokenMap.set(sessionId, tokens);
      const newStreamingMap = new Map(state.streamingMap);
      newStreamingMap.set(sessionId, false);
      const newBufferMap = new Map(state.streamBufferMap);
      newBufferMap.set(sessionId, '');
      set({ messages: newMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap, tokenUsage: newTokenMap });
    }
  },

  // ── Confirm request ──────────────────────────────────────────────────────

  onConfirmRequest: (sessionId, requestId, tool, input, reason) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    msgs.push({
      id: nextId(),
      role: 'system',
      content: '',
      confirmPending: true,
      confirmRequestId: requestId,
      confirmTool: tool,
      confirmInput: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
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
        return { ...m, confirmPending: false, content: approved ? '✓ 已允许' : '✗ 已拒绝' };
      }
      return m;
    });
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap });

    if (state.directSend) {
      state.directSend({ channel: 'chat', action: 'confirm_response', data: { requestId, approved } });
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

      if (msg.type === 'thinking_delta') {
        get().onThinkingDelta(sessionId, msg.content ?? '');
        return;
      }

      if (msg.type === 'consolidation') {
        get().onConsolidation(sessionId, msg.message ?? '');
        return;
      }

      if (msg.type === 'plan_mode') {
        get().onPlanMode(sessionId, (msg as any).active ?? false);
        return;
      }

      if (msg.type === 'subagent_started') {
        get().onConsolidation(sessionId, `[子 Agent 启动] ${msg.label ?? msg.taskId}`);
        return;
      }
      if (msg.type === 'subagent_result') {
        get().onConsolidation(sessionId, `[子 Agent 完成] ${msg.taskId}: ${msg.output ?? ''}`);
        return;
      }

      // Legacy tool_use
      if (msg.type === 'tool_use') {
        const legacyId = `legacy-${nextId()}`;
        get().onToolUseStart(sessionId, legacyId, msg.tool ?? 'unknown');
        if (msg.input !== undefined) {
          get().onToolUseDelta(sessionId, legacyId, typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input, null, 2));
        }
        get().onToolUseEnd(sessionId, legacyId);
        return;
      }

      if (msg.type === 'session_done' || msg.type === 'done') {
        const rawTokens = msg.tokens;
        const tokens: TokenUsage = rawTokens && typeof rawTokens === 'object'
          ? (rawTokens as TokenUsage)
          : { inputTokens: 0, outputTokens: typeof rawTokens === 'number' ? rawTokens : 0 };
        get().onSessionDone(sessionId, tokens);
        return;
      }

      if (msg.type === 'confirm_request') {
        get().onConfirmRequest(sessionId, msg.requestId ?? '', msg.tool ?? '', msg.input, msg.reason ?? '');
        return;
      }

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
