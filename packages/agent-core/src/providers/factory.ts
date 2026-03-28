/**
 * Provider 工厂 — 根据配置创建 LLM provider 实例。
 */

import type { LLMProvider, ProviderConfig } from './types.js';
import { CompatProvider } from './compat.js';

/**
 * 创建 LLM provider。当前所有类型均使用 CompatProvider（OpenAI 兼容协议）。
 * 后续可根据 config.type 分发到不同实现。
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  if (!config.apiKey) {
    throw new Error('apiKey is required');
  }
  return new CompatProvider(config);
}
