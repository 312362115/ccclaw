import { describe, it, expect, afterEach } from 'vitest';
import { MessageBus } from './index.js';
import type { InboundMessage, OutboundMessage } from './events.js';

let bus: MessageBus;

afterEach(() => {
  bus?.removeAllListeners();
});

describe('MessageBus', () => {
  it('发布和消费入站消息', () => {
    bus = new MessageBus();
    const received: InboundMessage[] = [];

    bus.onInbound((msg) => received.push(msg));

    bus.publishInbound({
      type: 'user_message',
      workspaceId: 'ws-1',
      sessionId: 's-1',
      userId: 'u-1',
      channelType: 'webui',
      content: 'hello',
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('user_message');
  });

  it('发布和消费出站消息', () => {
    bus = new MessageBus();
    const received: OutboundMessage[] = [];

    bus.onOutbound((msg) => received.push(msg));

    bus.publishOutbound({
      type: 'text_delta',
      sessionId: 's-1',
      content: 'hi',
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('text_delta');
  });

  it('按 session 过滤出站消息', () => {
    bus = new MessageBus();
    const s1Messages: OutboundMessage[] = [];
    const s2Messages: OutboundMessage[] = [];

    bus.onSessionOutbound('s-1', (msg) => s1Messages.push(msg));
    bus.onSessionOutbound('s-2', (msg) => s2Messages.push(msg));

    bus.publishOutbound({ type: 'text_delta', sessionId: 's-1', content: 'for s1' });
    bus.publishOutbound({ type: 'text_delta', sessionId: 's-2', content: 'for s2' });
    bus.publishOutbound({ type: 'done', sessionId: 's-1', tokens: 100 });

    expect(s1Messages).toHaveLength(2);
    expect(s2Messages).toHaveLength(1);
  });

  it('取消监听', () => {
    bus = new MessageBus();
    const received: InboundMessage[] = [];
    const handler = (msg: InboundMessage) => received.push(msg);

    bus.onInbound(handler);
    bus.publishInbound({
      type: 'user_message',
      workspaceId: 'ws-1',
      sessionId: 's-1',
      userId: 'u-1',
      channelType: 'webui',
      content: 'msg1',
    });

    bus.offInbound(handler);
    bus.publishInbound({
      type: 'user_message',
      workspaceId: 'ws-1',
      sessionId: 's-1',
      userId: 'u-1',
      channelType: 'webui',
      content: 'msg2',
    });

    expect(received).toHaveLength(1);
  });

  it('多消费者同时接收', () => {
    bus = new MessageBus();
    const r1: OutboundMessage[] = [];
    const r2: OutboundMessage[] = [];

    bus.onOutbound((msg) => r1.push(msg));
    bus.onOutbound((msg) => r2.push(msg));

    bus.publishOutbound({ type: 'error', sessionId: 's-1', message: 'oops' });

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it('cancel 和 confirm_response 消息', () => {
    bus = new MessageBus();
    const received: InboundMessage[] = [];
    bus.onInbound((msg) => received.push(msg));

    bus.publishInbound({ type: 'cancel', workspaceId: 'ws-1', sessionId: 's-1' });
    bus.publishInbound({
      type: 'confirm_response',
      workspaceId: 'ws-1',
      sessionId: 's-1',
      requestId: 'req-1',
      approved: true,
    });

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe('cancel');
    expect(received[1].type).toBe('confirm_response');
  });
});
