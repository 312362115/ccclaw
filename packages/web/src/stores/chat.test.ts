import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat';

function resetStore() {
  useChatStore.setState({
    messages: new Map(),
    streamingMap: new Map(),
    streamBufferMap: new Map(),
    streamErrorMap: new Map(),
    planModeMap: new Map(),
    pendingImages: new Map(),
    currentSessionId: null,
    tokenUsage: new Map(),
  });
}

describe('chat store', () => {
  beforeEach(resetStore);

  describe('session isolation', () => {
    it('streaming 状态应按 sessionId 隔离', () => {
      const streamingMap = new Map([['sess-a', true]]);
      const bufferMap = new Map([['sess-a', 'Hello ']]);
      useChatStore.setState({ streamingMap, streamBufferMap: bufferMap });

      expect(useChatStore.getState().isStreaming('sess-a')).toBe(true);
      expect(useChatStore.getState().isStreaming('sess-b')).toBe(false);
      expect(useChatStore.getState().getStreamBuffer('sess-a')).toBe('Hello ');
      expect(useChatStore.getState().getStreamBuffer('sess-b')).toBe('');
    });

    it('onSessionDone 应只影响指定 session', () => {
      useChatStore.setState({
        streamingMap: new Map([['sess-a', true], ['sess-b', true]]),
        streamBufferMap: new Map([['sess-a', 'A response'], ['sess-b', 'B response']]),
        messages: new Map([['sess-a', []], ['sess-b', []]]),
      });

      useChatStore.getState().onSessionDone('sess-a', { inputTokens: 100, outputTokens: 50 });

      expect(useChatStore.getState().isStreaming('sess-a')).toBe(false);
      expect(useChatStore.getState().isStreaming('sess-b')).toBe(true);
      expect(useChatStore.getState().getStreamBuffer('sess-b')).toBe('B response');
    });
  });

  describe('tool calls — 合并到 AI 消息', () => {
    it('onToolUseStart 应在 assistant 消息的 toolCalls 中追加', () => {
      useChatStore.setState({
        messages: new Map([['sess-1', [
          { id: 'u1', role: 'user' as const, content: 'hello', timestamp: 1 },
        ]]]),
        streamBufferMap: new Map([['sess-1', '']]),
      });

      useChatStore.getState().onToolUseStart('sess-1', 'tc-1', 'bash');

      const msgs = useChatStore.getState().getMessages('sess-1');
      // 应该有 2 条：user + assistant（自动创建）
      expect(msgs).toHaveLength(2);
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].toolCalls).toHaveLength(1);
      expect(msgs[1].toolCalls![0].name).toBe('bash');
      expect(msgs[1].toolCalls![0].status).toBe('running');
    });

    it('onToolResult 应更新 toolCall 状态', () => {
      useChatStore.setState({
        messages: new Map([['sess-1', [
          { id: 'u1', role: 'user' as const, content: 'hello', timestamp: 1 },
          { id: 'a1', role: 'assistant' as const, content: '', toolCalls: [
            { id: 'tc-1', name: 'bash', input: '{"command":"ls"}', output: '', status: 'running' as const, expanded: false },
          ], timestamp: 2 },
        ]]]),
      });

      useChatStore.getState().onToolResult('sess-1', 'tc-1', 'file1.ts\nfile2.ts');

      const msgs = useChatStore.getState().getMessages('sess-1');
      expect(msgs[1].toolCalls![0].status).toBe('success');
      expect(msgs[1].toolCalls![0].output).toBe('file1.ts\nfile2.ts');
    });

    it('错误工具应自动展开', () => {
      useChatStore.setState({
        messages: new Map([['sess-1', [
          { id: 'a1', role: 'assistant' as const, content: '', toolCalls: [
            { id: 'tc-1', name: 'bash', input: '', output: '', status: 'running' as const, expanded: false },
          ], timestamp: 1 },
        ]]]),
      });

      useChatStore.getState().onToolResult('sess-1', 'tc-1', 'Error: command not found');

      const msgs = useChatStore.getState().getMessages('sess-1');
      expect(msgs[0].toolCalls![0].status).toBe('error');
      expect(msgs[0].toolCalls![0].expanded).toBe(true);
    });

    it('Hook 输出应从 tool output 中提取', () => {
      useChatStore.setState({
        messages: new Map([['sess-1', [
          { id: 'a1', role: 'assistant' as const, content: '', toolCalls: [
            { id: 'tc-1', name: 'edit', input: '', output: '', status: 'running' as const, expanded: false },
          ], timestamp: 1 },
        ]]]),
      });

      useChatStore.getState().onToolResult('sess-1', 'tc-1', 'file updated\n[Hook] eslint: 0 errors');

      const tc = useChatStore.getState().getMessages('sess-1')[0].toolCalls![0];
      expect(tc.output).toBe('file updated');
      expect(tc.hookOutput).toBe('eslint: 0 errors');
    });
  });

  describe('plan mode', () => {
    it('onPlanMode 应更新 planModeMap', () => {
      useChatStore.getState().onPlanMode('sess-1', true);
      expect(useChatStore.getState().isPlanMode('sess-1')).toBe(true);

      useChatStore.getState().onPlanMode('sess-1', false);
      expect(useChatStore.getState().isPlanMode('sess-1')).toBe(false);
    });
  });

  describe('pending images', () => {
    it('addPendingImage / removePendingImage', () => {
      useChatStore.getState().addPendingImage('sess-1', { data: 'abc', mediaType: 'image/png' });
      useChatStore.getState().addPendingImage('sess-1', { data: 'def', mediaType: 'image/jpeg' });

      expect(useChatStore.getState().getPendingImages('sess-1')).toHaveLength(2);

      useChatStore.getState().removePendingImage('sess-1', 0);
      expect(useChatStore.getState().getPendingImages('sess-1')).toHaveLength(1);
      expect(useChatStore.getState().getPendingImages('sess-1')[0].data).toBe('def');
    });
  });

  describe('toggleToolExpanded', () => {
    it('应切换指定 toolCall 的 expanded 状态', () => {
      useChatStore.setState({
        messages: new Map([['sess-1', [
          { id: 'a1', role: 'assistant' as const, content: 'hi', toolCalls: [
            { id: 'tc-1', name: 'bash', input: '', output: 'ok', status: 'success' as const, expanded: false },
          ], timestamp: 1 },
        ]]]),
      });

      useChatStore.getState().toggleToolExpanded('sess-1', 'a1', 'tc-1');
      expect(useChatStore.getState().getMessages('sess-1')[0].toolCalls![0].expanded).toBe(true);

      useChatStore.getState().toggleToolExpanded('sess-1', 'a1', 'tc-1');
      expect(useChatStore.getState().getMessages('sess-1')[0].toolCalls![0].expanded).toBe(false);
    });
  });
});
