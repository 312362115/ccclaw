/**
 * ProfileRegistry — 模型 Profile 注册与查询
 *
 * 匹配规则（优先级递减）：
 * 1. 精确匹配（profile.id === modelId）
 * 2. 前缀匹配（modelId.startsWith(profile.id)），适配版本号后缀
 * 3. 无匹配 → 返回 _default Profile
 */

import type { ModelProfile, ModelRole, AgentPhase } from '../model-profile.js';
import { defaultProfile } from './_default.js';
import { alibabaProfiles } from './alibaba.js';
import { anthropicProfiles } from './anthropic.js';
import { openaiProfiles } from './openai.js';
import { googleProfiles } from './google.js';
import { deepseekProfiles } from './deepseek.js';

// ====== ProfileRegistry ======

export class ProfileRegistry {
  private profiles: ModelProfile[] = [];

  constructor() {
    // 注册所有内置 Profile
    this.registerAll(alibabaProfiles);
    this.registerAll(anthropicProfiles);
    this.registerAll(openaiProfiles);
    this.registerAll(googleProfiles);
    this.registerAll(deepseekProfiles);
  }

  /** 注册一组 Profile */
  registerAll(profiles: ModelProfile[]): void {
    this.profiles.push(...profiles);
  }

  /** 注册单个 Profile */
  register(profile: ModelProfile): void {
    this.profiles.push(profile);
  }

  /**
   * 根据模型 ID 查找 Profile。
   * 1. 精确匹配
   * 2. 前缀匹配（modelId 以 profile.id 开头，用于版本号变体）
   * 3. 无匹配 → 返回 default Profile
   */
  resolve(modelId: string): ModelProfile {
    if (!modelId) return defaultProfile;

    // 精确匹配
    const exact = this.profiles.find(p => p.id === modelId);
    if (exact) return exact;

    // 前缀匹配：找最长前缀（更精确的匹配优先）
    let bestMatch: ModelProfile | null = null;
    let bestLen = 0;
    for (const p of this.profiles) {
      if (modelId.startsWith(p.id) && p.id.length > bestLen) {
        bestMatch = p;
        bestLen = p.id.length;
      }
    }
    if (bestMatch) return bestMatch;

    return defaultProfile;
  }

  /**
   * 根据角色和偏好选模型。
   * 在指定 vendor 的 Profile 中，找匹配 role 的，按偏好排序。
   */
  selectForRole(
    role: ModelRole,
    vendor?: string,
    preference: 'capability' | 'cost' = 'capability',
  ): ModelProfile | null {
    const candidates = this.profiles.filter(p => {
      if (vendor && p.vendor !== vendor) return false;
      return p.routing?.roles.includes(role) ?? false;
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aRouting = a.routing!;
      const bRouting = b.routing!;
      if (preference === 'capability') {
        return bRouting.capabilityTier - aRouting.capabilityTier;
      }
      return bRouting.costEfficiency - aRouting.costEfficiency;
    });

    return candidates[0];
  }

  /**
   * 获取模型在指定阶段的参数（defaults + overrides 合并）
   */
  getPhaseParams(modelId: string, phase?: AgentPhase): { temperature: number; maxTokens: number } {
    const profile = this.resolve(modelId);
    const base = { ...profile.defaults };

    if (phase && profile.overrides?.[phase]) {
      const override = profile.overrides[phase]!;
      if (override.temperature !== undefined) base.temperature = override.temperature;
      if (override.maxTokens !== undefined) base.maxTokens = override.maxTokens;
    }

    return base;
  }

  /** 列出所有已注册的 Profile */
  listAll(): readonly ModelProfile[] {
    return this.profiles;
  }

  /** 列出指定厂商的所有 Profile */
  listByVendor(vendor: string): ModelProfile[] {
    return this.profiles.filter(p => p.vendor === vendor);
  }
}
