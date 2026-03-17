import type { LLMProvider, ProviderConfig } from './types.js';
import { ProviderConfigError } from './types.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { GeminiAdapter } from './gemini.js';
import { CompatAdapter } from './compat.js';

export class LLMProviderFactory {
  static create(config: ProviderConfig): LLMProvider {
    if (!config.apiKey) {
      throw new ProviderConfigError('API key or token is required', 'apiKey');
    }
    switch (config.type) {
      case 'claude': return new AnthropicAdapter(config);
      case 'openai': return new OpenAIAdapter(config);
      case 'gemini': return new GeminiAdapter(config);
      default:
        if (!config.apiBase) {
          throw new ProviderConfigError(`Unknown provider "${config.type}" requires apiBase`, 'apiBase');
        }
        return new CompatAdapter(config);
    }
  }
}
