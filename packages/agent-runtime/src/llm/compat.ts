import { OpenAIAdapter } from './openai.js';
import type { ProviderConfig, ProviderCapabilities } from './types.js';
import { ProviderConfigError } from './types.js';

export class CompatAdapter extends OpenAIAdapter {
  constructor(config: ProviderConfig) {
    if (!config.apiBase) {
      throw new ProviderConfigError('CompatAdapter requires apiBase for custom endpoint', 'apiBase');
    }
    super(config);
  }

  capabilities(): ProviderCapabilities {
    // CompatAdapter 继承 OpenAIAdapter，如果注入了 ProfileRegistry 则委托给 Profile
    // 否则使用保守的兜底值（未知兼容服务）
    const parentCaps = super.capabilities();
    // 如果 parent 已经委托了 Profile，直接返回
    if ((this as any).profileRegistry) return parentCaps;

    return {
      streaming: true,
      toolUse: true,
      extendedThinking: false,
      promptCaching: false,
      vision: false,
      contextWindow: 32_000,
      maxOutputTokens: 4096,
    };
  }
}
