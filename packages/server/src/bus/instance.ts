/**
 * MessageBus 单例 — 全局消息总线实例
 *
 * 所有模块通过此实例通信，避免多实例导致消息丢失。
 */

import { MessageBus } from './index.js';

export const messageBus = new MessageBus();
