import type { LLMProvider, ProviderConfig } from './types.js';
import { ProviderConfigError } from './types.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { GeminiAdapter } from './gemini.js';
import { CompatAdapter } from './compat.js';
import { ProfileRegistry } from './profiles/index.js';

/** 全局共享的 ProfileRegistry 单例 */
let sharedRegistry: ProfileRegistry | null = null;

export function getProfileRegistry(): ProfileRegistry {
  if (!sharedRegistry) {
    sharedRegistry = new ProfileRegistry();
  }
  return sharedRegistry;
}

export class LLMProviderFactory {
  static create(config: ProviderConfig): LLMProvider {
    if (!config.apiKey) {
      throw new ProviderConfigError('API key or token is required', 'apiKey');
    }

    const registry = getProfileRegistry();
    let provider: LLMProvider;

    switch (config.type) {
      case 'claude': {
        const adapter = new AnthropicAdapter(config);
        adapter.setProfileRegistry(registry);
        provider = adapter;
        break;
      }
      case 'openai': {
        const adapter = new OpenAIAdapter(config);
        adapter.setProfileRegistry(registry);
        provider = adapter;
        break;
      }
      case 'gemini': {
        const adapter = new GeminiAdapter(config);
        adapter.setProfileRegistry(registry);
        provider = adapter;
        break;
      }
      default: {
        if (!config.apiBase) {
          throw new ProviderConfigError(`Unknown provider "${config.type}" requires apiBase`, 'apiBase');
        }
        const adapter = new CompatAdapter(config);
        adapter.setProfileRegistry(registry);
        provider = adapter;
        break;
      }
    }

    return provider;
  }
}
