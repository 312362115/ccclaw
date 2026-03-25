import { describe, it, expect, beforeEach } from 'vitest';
import { ProfileRegistry } from './index.js';

describe('ProfileRegistry', () => {
  let registry: ProfileRegistry;

  beforeEach(() => {
    registry = new ProfileRegistry();
  });

  describe('resolve', () => {
    it('精确匹配已注册的模型', () => {
      const profile = registry.resolve('qwen-max');
      expect(profile.id).toBe('qwen-max');
      expect(profile.vendor).toBe('alibaba');
    });

    it('前缀匹配版本号变体', () => {
      const profile = registry.resolve('claude-opus-4-20250514');
      expect(profile.id).toBe('claude-opus-4');
      expect(profile.displayName).toBe('Claude Opus 4');
    });

    it('前缀匹配选最长匹配', () => {
      // gpt-4o-mini 应匹配 'gpt-4o-mini' 而非 'gpt-4o'
      const profile = registry.resolve('gpt-4o-mini-2025-01');
      expect(profile.id).toBe('gpt-4o-mini');
    });

    it('未知模型返回 default Profile', () => {
      const profile = registry.resolve('totally-unknown-model');
      expect(profile.id).toBe('_default');
      expect(profile.vendor).toBe('unknown');
    });

    it('空字符串返回 default', () => {
      const profile = registry.resolve('');
      expect(profile.id).toBe('_default');
    });
  });

  describe('selectForRole', () => {
    it('按角色 + vendor 选模型', () => {
      const profile = registry.selectForRole('subagent', 'alibaba', 'cost');
      expect(profile).not.toBeNull();
      expect(profile!.id).toBe('qwen-turbo');
    });

    it('按能力选 planning 模型', () => {
      const profile = registry.selectForRole('planning', 'anthropic', 'capability');
      expect(profile).not.toBeNull();
      expect(profile!.id).toBe('claude-opus-4');
    });

    it('无匹配返回 null', () => {
      const profile = registry.selectForRole('primary', 'nonexistent-vendor');
      expect(profile).toBeNull();
    });
  });

  describe('getPhaseParams', () => {
    it('默认参数', () => {
      const params = registry.getPhaseParams('qwen-max');
      expect(params.temperature).toBe(0.1);
      expect(params.maxTokens).toBe(8192);
    });

    it('阶段覆盖参数', () => {
      const params = registry.getPhaseParams('qwen-max', 'planning');
      expect(params.temperature).toBe(0.2);
      expect(params.maxTokens).toBe(4096);
    });

    it('无覆盖的阶段使用默认', () => {
      const params = registry.getPhaseParams('qwen-turbo', 'coding');
      expect(params.temperature).toBe(0.1);
      expect(params.maxTokens).toBe(4096);
    });
  });

  describe('register', () => {
    it('可动态注册新 Profile', () => {
      registry.register({
        id: 'custom-model',
        displayName: 'Custom Model',
        vendor: 'custom',
        capabilities: {
          contextWindow: 16000,
          maxOutputTokens: 2048,
          toolUse: false,
          extendedThinking: false,
          vision: false,
          promptCaching: false,
          jsonMode: false,
          parallelToolCalls: false,
        },
        defaults: { temperature: 0.5, maxTokens: 2048 },
        promptStrategy: {
          maxSystemPromptTokens: 2000,
          needsToolExamples: true,
          preferPhasedPrompt: true,
        },
        executionStrategy: {
          maxConcurrentToolCalls: 1,
          benefitsFromVerifyFix: true,
          benefitsFromAutoPlan: true,
          benefitsFromReview: true,
        },
      });

      const profile = registry.resolve('custom-model');
      expect(profile.id).toBe('custom-model');
      expect(profile.vendor).toBe('custom');
    });
  });

  describe('各厂商 Profile 完整性', () => {
    it('Alibaba 至少 3 个模型', () => {
      const profiles = registry.listByVendor('alibaba');
      expect(profiles.length).toBeGreaterThanOrEqual(3);
    });

    it('Anthropic 至少 3 个模型', () => {
      const profiles = registry.listByVendor('anthropic');
      expect(profiles.length).toBeGreaterThanOrEqual(3);
    });

    it('所有 Profile 有 required 字段', () => {
      for (const profile of registry.listAll()) {
        expect(profile.id).toBeTruthy();
        expect(profile.displayName).toBeTruthy();
        expect(profile.vendor).toBeTruthy();
        expect(profile.capabilities.contextWindow).toBeGreaterThan(0);
        expect(profile.defaults.maxTokens).toBeGreaterThan(0);
      }
    });
  });
});
