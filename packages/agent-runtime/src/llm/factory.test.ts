import { describe, it, expect } from 'vitest';
import { LLMProviderFactory } from './factory.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { GeminiAdapter } from './gemini.js';
import { CompatAdapter } from './compat.js';
import { ProviderConfigError } from './types.js';

describe('LLMProviderFactory', () => {
  it('type=claude returns AnthropicAdapter', () => {
    const provider = LLMProviderFactory.create({
      type: 'claude',
      apiKey: 'test-key',
    });
    expect(provider).toBeInstanceOf(AnthropicAdapter);
  });

  it('type=openai returns OpenAIAdapter', () => {
    const provider = LLMProviderFactory.create({
      type: 'openai',
      apiKey: 'test-key',
    });
    expect(provider).toBeInstanceOf(OpenAIAdapter);
  });

  it('type=gemini returns GeminiAdapter', () => {
    const provider = LLMProviderFactory.create({
      type: 'gemini',
      apiKey: 'test-key',
    });
    expect(provider).toBeInstanceOf(GeminiAdapter);
  });

  it('type=deepseek with apiBase returns CompatAdapter', () => {
    const provider = LLMProviderFactory.create({
      type: 'deepseek',
      apiKey: 'test-key',
      apiBase: 'https://api.deepseek.com',
    });
    expect(provider).toBeInstanceOf(CompatAdapter);
  });

  it('unknown type without apiBase throws ProviderConfigError', () => {
    expect(() =>
      LLMProviderFactory.create({
        type: 'unknown-provider',
        apiKey: 'test-key',
      })
    ).toThrow(ProviderConfigError);
  });

  it('empty apiKey throws ProviderConfigError', () => {
    expect(() =>
      LLMProviderFactory.create({
        type: 'claude',
        apiKey: '',
      })
    ).toThrow(ProviderConfigError);
  });
});
