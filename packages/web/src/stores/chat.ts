import { create } from 'zustand';
import { sendMessage, onWsMessage, type WsIncoming } from '../api/ws';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  timestamp: number;
}

interface ChatState {
  messages: Map<string, ChatMessage[]>; // sessionId → messages
  streaming: boolean;
  streamBuffer: string;
  currentSessionId: string | null;

  setCurrentSession: (sessionId: string) => void;
  send: (workspaceId: string, sessionId: string, content: string) => void;
  getMessages: (sessionId: string) => ChatMessage[];
  initWsListener: () => () => void;
}

let msgCounter = 0;
function nextId() { return `msg-${Date.now()}-${++msgCounter}`; }

export const useChatStore = create<ChatState>((set, get) => ({
  messages: new Map(),
  streaming: false,
  streamBuffer: '',
  currentSessionId: null,

  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  send: (workspaceId, sessionId, content) => {
    const state = get();
    const msgs = [...(state.messages.get(sessionId) || [])];
    msgs.push({ id: nextId(), role: 'user', content, timestamp: Date.now() });
    const newMap = new Map(state.messages);
    newMap.set(sessionId, msgs);
    set({ messages: newMap, streaming: true, streamBuffer: '' });
    sendMessage(workspaceId, sessionId, content);
  },

  getMessages: (sessionId) => get().messages.get(sessionId) || [],

  initWsListener: () => {
    return onWsMessage((msg: WsIncoming) => {
      const sessionId = msg.sessionId;
      if (!sessionId) return;

      const state = get();

      if (msg.type === 'text_delta') {
        const text = msg.content || msg.text || '';
        set({ streamBuffer: state.streamBuffer + text });
      }

      if (msg.type === 'tool_use') {
        const msgs = [...(state.messages.get(sessionId) || [])];
        msgs.push({
          id: nextId(),
          role: 'tool',
          content: `调用工具: ${msg.tool}`,
          toolName: msg.tool,
          toolInput: msg.input,
          timestamp: Date.now(),
        });
        const newMap = new Map(state.messages);
        newMap.set(sessionId, msgs);
        set({ messages: newMap });
      }

      if (msg.type === 'done') {
        const buffer = get().streamBuffer;
        if (buffer) {
          const msgs = [...(state.messages.get(sessionId) || [])];
          msgs.push({ id: nextId(), role: 'assistant', content: buffer, timestamp: Date.now() });
          const newMap = new Map(state.messages);
          newMap.set(sessionId, msgs);
          set({ messages: newMap, streaming: false, streamBuffer: '' });
        } else {
          set({ streaming: false });
        }
      }

      if (msg.type === 'error') {
        const msgs = [...(state.messages.get(sessionId) || [])];
        msgs.push({ id: nextId(), role: 'assistant', content: `[错误] ${msg.message}`, timestamp: Date.now() });
        const newMap = new Map(state.messages);
        newMap.set(sessionId, msgs);
        set({ messages: newMap, streaming: false, streamBuffer: '' });
      }
    });
  },
}));
