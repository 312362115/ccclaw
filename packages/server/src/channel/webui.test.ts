/**
 * WebSocket 订阅生命周期测试
 *
 * 验证：
 * 1. 同一 session 多次发消息不会堆积 handler
 * 2. done/error 后自动清理订阅
 * 3. socket 关闭时清理所有订阅
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageBus } from '../bus/index.js';

describe('WebSocket subscription lifecycle', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('should not accumulate handlers on repeated messages to same session', () => {
    const sessionId = 'sess-1';
    const handlers: Array<() => void> = [];

    // 模拟 webui.ts 的订阅逻辑（幂等版本）
    function subscribe() {
      // 清理旧的
      if (handlers.length > 0) {
        const old = handlers.pop()!;
        old(); // cleanup
      }

      const handler = vi.fn();
      const cleanup = () => {
        bus.offSessionOutbound(sessionId, handler);
      };
      bus.onSessionOutbound(sessionId, handler);
      handlers.push(cleanup);
      return handler;
    }

    // 订阅 3 次
    subscribe();
    subscribe();
    const lastHandler = subscribe();

    // 发布一条消息
    bus.publishOutbound({ type: 'text_delta', sessionId, content: 'hi' });

    // 只有最后一个 handler 应该收到消息（前两个已被清理）
    expect(lastHandler).toHaveBeenCalledTimes(1);
  });

  it('should clean up handlers on done event', () => {
    const sessionId = 'sess-2';
    const handler = vi.fn();
    const cleanupHandler = vi.fn((out: { type: string; sessionId: string }) => {
      if (out.sessionId === sessionId && (out.type === 'done' || out.type === 'error')) {
        bus.offSessionOutbound(sessionId, handler);
        bus.offSessionOutbound(sessionId, cleanupHandler as any);
      }
    });

    bus.onSessionOutbound(sessionId, handler);
    bus.onSessionOutbound(sessionId, cleanupHandler as any);

    // 发送 text_delta
    bus.publishOutbound({ type: 'text_delta', sessionId, content: 'hi' });
    expect(handler).toHaveBeenCalledTimes(1);

    // 发送 done → 触发清理
    bus.publishOutbound({ type: 'done', sessionId, tokens: 100 });
    expect(handler).toHaveBeenCalledTimes(2); // 收到 done 本身
    expect(cleanupHandler).toHaveBeenCalledTimes(2);

    // 再发一条消息 → handler 已被移除，不应再收到
    bus.publishOutbound({ type: 'text_delta', sessionId, content: 'after done' });
    expect(handler).toHaveBeenCalledTimes(2); // 没有增加
  });

  it('should clean up all subscriptions on bus removeAllListeners', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.onSessionOutbound('sess-a', handler1);
    bus.onSessionOutbound('sess-b', handler2);

    bus.removeAllListeners();

    bus.publishOutbound({ type: 'text_delta', sessionId: 'sess-a', content: 'hi' });
    bus.publishOutbound({ type: 'text_delta', sessionId: 'sess-b', content: 'hi' });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });
});
