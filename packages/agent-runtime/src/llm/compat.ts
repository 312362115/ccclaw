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
