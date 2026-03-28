import { describe, it, expect } from 'vitest';
import { resolveHarnessTier, buildHarnessConfig } from '../harness/adaptive.js';
import type { ModelProfile } from '../profiles/types.js';
import type { HarnessConfig } from '../harness/types.js';

/** 构建最小化的 ModelProfile 用于测试 */
function makeProfile(capabilityTier?: number): ModelProfile {
  return {
    id: 'test-model',
    displayName: 'Test Model',
    vendor: 'openai',
    capabilities: {
      contextWindow: 128000,
      maxOutputTokens: 4096,
      toolUse: true,
      extendedThinking: false,
      vision: false,
      promptCaching: false,
      jsonMode: true,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.7, maxTokens: 4096 },
    promptStrategy: {
      maxSystemPromptTokens: 4000,
      needsToolExamples: false,
      preferPhasedPrompt: false,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 1,
      benefitsFromVerifyFix: false,
      benefitsFromAutoPlan: false,
      benefitsFromReview: false,
    },
    routing: capabilityTier !== undefined
      ? { roles: ['primary'], costEfficiency: 3, capabilityTier }
      : undefined,
  };
}

// ============================================================
// resolveHarnessTier
// ============================================================

describe('resolveHarnessTier', () => {
  it('tier 5 → light', () => {
    expect(resolveHarnessTier(makeProfile(5))).toBe('light');
  });

  it('tier 4 → medium', () => {
    expect(resolveHarnessTier(makeProfile(4))).toBe('medium');
  });

  it('tier 3 → medium', () => {
    expect(resolveHarnessTier(makeProfile(3))).toBe('medium');
  });

  it('tier 2 → heavy', () => {
    expect(resolveHarnessTier(makeProfile(2))).toBe('heavy');
  });

  it('tier 1 → heavy', () => {
    expect(resolveHarnessTier(makeProfile(1))).toBe('heavy');
  });

  it('无 routing 时默认 medium（capabilityTier 默认 3）', () => {
    expect(resolveHarnessTier(makeProfile())).toBe('medium');
  });
});

// ============================================================
// buildHarnessConfig
// ============================================================

describe('buildHarnessConfig', () => {
  it('light 层级默认配置正确', () => {
    const config = buildHarnessConfig(makeProfile(5));
    expect(config).toEqual<HarnessConfig>({
      tier: 'light',
      forceCliMode: false,
      singleToolPerTurn: false,
      injectToolGuidance: false,
      injectChainOfThought: false,
      maxParseRetries: 0,
      compressionTriggerRatio: 0.85,
    });
  });

  it('medium 层级默认配置正确', () => {
    const config = buildHarnessConfig(makeProfile(3));
    expect(config).toEqual<HarnessConfig>({
      tier: 'medium',
      forceCliMode: false,
      singleToolPerTurn: true,
      injectToolGuidance: true,
      injectChainOfThought: true,
      maxParseRetries: 1,
      compressionTriggerRatio: 0.75,
    });
  });

  it('heavy 层级默认配置正确', () => {
    const config = buildHarnessConfig(makeProfile(1));
    expect(config).toEqual<HarnessConfig>({
      tier: 'heavy',
      forceCliMode: true,
      singleToolPerTurn: true,
      injectToolGuidance: true,
      injectChainOfThought: true,
      maxParseRetries: 2,
      compressionTriggerRatio: 0.65,
    });
  });

  it('overrides 可覆盖默认值', () => {
    const config = buildHarnessConfig(makeProfile(5), {
      forceCliMode: true,
      maxParseRetries: 3,
    });
    expect(config.tier).toBe('light');
    expect(config.forceCliMode).toBe(true);
    expect(config.maxParseRetries).toBe(3);
    // 未覆盖的字段保持默认
    expect(config.singleToolPerTurn).toBe(false);
  });

  it('overrides 可覆盖 tier 字段', () => {
    const config = buildHarnessConfig(makeProfile(5), { tier: 'heavy' });
    // tier 字段被覆盖，但其他配置仍来自 light 默认
    expect(config.tier).toBe('heavy');
    expect(config.forceCliMode).toBe(false);
  });
});
