import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat';

describe('chat store — session isolation', () => {
  beforeEach(() => {
    // 重置 store 状态
    useChatStore.setState({
      messages: new Map(),
      streamingMap: new Map(),
      streamBufferMap: new Map(),
      streamErrorMap: new Map(),
      currentSessionId: null,
      tokenUsage: new Map(),
    });
  });

  it('streaming 状态应按 sessionId 隔离', () => {
    const store = useChatStore.getState();

    // session A 开始流式
    const streamingMap = new Map([['sess-a', true]]);
    const bufferMap = new Map([['sess-a', 'Hello ']]);
    useChatStore.setState({ streamingMap, streamBufferMap: bufferMap });

    expect(useChatStore.getState().isStreaming('sess-a')).toBe(true);
    expect(useChatStore.getState().isStreaming('sess-b')).toBe(false);
    expect(useChatStore.getState().getStreamBuffer('sess-a')).toBe('Hello ');
    expect(useChatStore.getState().getStreamBuffer('sess-b')).toBe('');
  });

  it('两个 session 交错收到 text_delta 不应串流', () => {
    // 模拟 session A 收到 text_delta
    const bufferA = new Map([['sess-a', '']]);
    useChatStore.setState({ streamBufferMap: bufferA });

    // session A 收到 delta
    const s1 = useChatStore.getState();
    const buf1 = new Map(s1.streamBufferMap);
    buf1.set('sess-a', (buf1.get('sess-a') ?? '') + 'Hello ');
    useChatStore.setState({ streamBufferMap: buf1 });

    // session B 收到 delta
    const s2 = useChatStore.getState();
    const buf2 = new Map(s2.streamBufferMap);
    buf2.set('sess-b', (buf2.get('sess-b') ?? '') + 'World');
    useChatStore.setState({ streamBufferMap: buf2 });

    // 验证不串流
    expect(useChatStore.getState().getStreamBuffer('sess-a')).toBe('Hello ');
    expect(useChatStore.getState().getStreamBuffer('sess-b')).toBe('World');
  });

  it('onSessionDone 应只影响指定 session', () => {
    // 设置两个 session 都在流式中
    useChatStore.setState({
      streamingMap: new Map([['sess-a', true], ['sess-b', true]]),
      streamBufferMap: new Map([['sess-a', 'A response'], ['sess-b', 'B response']]),
      messages: new Map([['sess-a', []], ['sess-b', []]]),
    });

    // session A 完成
    useChatStore.getState().onSessionDone('sess-a', { inputTokens: 100, outputTokens: 50 });

    // session A 应完成
    expect(useChatStore.getState().isStreaming('sess-a')).toBe(false);
    expect(useChatStore.getState().getStreamBuffer('sess-a')).toBe('');

    // session B 不受影响
    expect(useChatStore.getState().isStreaming('sess-b')).toBe(true);
    expect(useChatStore.getState().getStreamBuffer('sess-b')).toBe('B response');
  });

  it('error 应只影响指定 session', () => {
    useChatStore.setState({
      streamingMap: new Map([['sess-a', true], ['sess-b', true]]),
      streamBufferMap: new Map([['sess-a', 'partial'], ['sess-b', 'other']]),
    });

    // session A 出错
    const s = useChatStore.getState();
    const newErrorMap = new Map(s.streamErrorMap);
    newErrorMap.set('sess-a', 'Provider 超时');
    const newStreamingMap = new Map(s.streamingMap);
    newStreamingMap.set('sess-a', false);
    const newBufferMap = new Map(s.streamBufferMap);
    newBufferMap.set('sess-a', '');
    useChatStore.setState({ streamErrorMap: newErrorMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap });

    // session A 应有错误
    expect(useChatStore.getState().getStreamError('sess-a')).toBe('Provider 超时');
    expect(useChatStore.getState().isStreaming('sess-a')).toBe(false);

    // session B 不受影响
    expect(useChatStore.getState().getStreamError('sess-b')).toBeNull();
    expect(useChatStore.getState().isStreaming('sess-b')).toBe(true);
    expect(useChatStore.getState().getStreamBuffer('sess-b')).toBe('other');
  });
});
