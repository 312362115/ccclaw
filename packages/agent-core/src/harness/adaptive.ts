/**
 * Harness 自适应层 — 根据模型能力评级自动调整 Agent 行为
 *
 * 强模型（tier 5）→ light harness：几乎不干预，信任模型自身能力
 * 中等模型（tier 3-4）→ medium harness：注入指南、限制并行调用
 * 弱模型（tier 1-2）→ heavy harness：强制 CLI 模式、注入 CoT、多次重试
 */

import type { ModelProfile } from '../profiles/types.js';
import type { HarnessTier, HarnessConfig } from './types.js';

/** 根据模型 Profile 推导 harness 层级 */
export function resolveHarnessTier(profile: ModelProfile): HarnessTier {
  const tier = profile.routing?.capabilityTier ?? 3;
  if (tier >= 5) return 'light';
  if (tier >= 3) return 'medium';
  return 'heavy';
}

/** 各层级的默认 HarnessConfig */
const TIER_DEFAULTS: Record<HarnessTier, HarnessConfig> = {
  light: {
    tier: 'light',
    forceCliMode: false,
    singleToolPerTurn: false,
    injectToolGuidance: false,
    injectChainOfThought: false,
    maxParseRetries: 0,
    compressionTriggerRatio: 0.85,
  },
  medium: {
    tier: 'medium',
    forceCliMode: false,
    singleToolPerTurn: true,
    injectToolGuidance: true,
    injectChainOfThought: true,
    maxParseRetries: 1,
    compressionTriggerRatio: 0.75,
  },
  heavy: {
    tier: 'heavy',
    forceCliMode: true,
    singleToolPerTurn: true,
    injectToolGuidance: true,
    injectChainOfThought: true,
    maxParseRetries: 2,
    compressionTriggerRatio: 0.65,
  },
};

/**
 * 根据模型 Profile 构建 HarnessConfig。
 * 先按能力评级选择默认配置，再应用用户覆盖。
 */
export function buildHarnessConfig(
  profile: ModelProfile,
  overrides?: Partial<HarnessConfig>,
): HarnessConfig {
  const tier = resolveHarnessTier(profile);
  const defaults = TIER_DEFAULTS[tier];
  return { ...defaults, ...overrides };
}
