/**
 * MessageBus — 消息总线
 *
 * 解耦渠道适配器与 AgentManager：
 * - 渠道发布 InboundMessage → AgentManager 消费
 * - AgentManager 发布 OutboundMessage → 渠道消费
 *
 * 基于 EventEmitter，进程内通信。
 */

import { EventEmitter } from 'node:events';
import type { InboundMessage, OutboundMessage } from './events.js';

export type InboundHandler = (msg: InboundMessage) => void;
export type OutboundHandler = (msg: OutboundMessage) => void;

export class MessageBus {
  private emitter = new EventEmitter();

  constructor() {
    // 提高监听器上限（多渠道场景）
    this.emitter.setMaxListeners(100);
  }

  /** 发布入站消息（渠道 → AgentManager） */
  publishInbound(msg: InboundMessage): void {
    this.emitter.emit('inbound', msg);
  }

  /** 发布出站消息（AgentManager → 渠道） */
  publishOutbound(msg: OutboundMessage): void {
    this.emitter.emit('outbound', msg);
    // 同时按 sessionId 发布，方便渠道按 session 过滤
    this.emitter.emit(`outbound:${msg.sessionId}`, msg);
  }

  /** 监听所有入站消息 */
  onInbound(handler: InboundHandler): void {
    this.emitter.on('inbound', handler);
  }

  /** 取消入站监听 */
  offInbound(handler: InboundHandler): void {
    this.emitter.off('inbound', handler);
  }

  /** 监听所有出站消息 */
  onOutbound(handler: OutboundHandler): void {
    this.emitter.on('outbound', handler);
  }

  /** 取消出站监听 */
  offOutbound(handler: OutboundHandler): void {
    this.emitter.off('outbound', handler);
  }

  /** 监听特定 session 的出站消息 */
  onSessionOutbound(sessionId: string, handler: OutboundHandler): void {
    this.emitter.on(`outbound:${sessionId}`, handler);
  }

  /** 取消特定 session 的出站监听 */
  offSessionOutbound(sessionId: string, handler: OutboundHandler): void {
    this.emitter.off(`outbound:${sessionId}`, handler);
  }

  /** 移除所有监听器（用于关闭） */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

export { type InboundMessage, type OutboundMessage } from './events.js';
