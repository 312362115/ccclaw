/**
 * ProfileRegistry — 模型 Profile 注册与查找
 *
 * 查找策略（按优先级）：
 * 1. 精确匹配 id
 * 2. 前缀匹配（modelId.startsWith(profile.id)）
 * 3. 兜底返回 defaultProfile
 */

import type { ModelProfile } from './types.js';
import { defaultProfile } from './_default.js';
import { alibabaProfiles } from './alibaba.js';

export class ProfileRegistry {
  private readonly profiles = new Map<string, ModelProfile>();

  constructor() {
    // 内置 Profile
    for (const profile of alibabaProfiles) {
      this.profiles.set(profile.id, profile);
    }
  }

  /** 注册自定义 Profile（覆盖同 id 的已有 Profile） */
  register(profile: ModelProfile): void {
    this.profiles.set(profile.id, profile);
  }

  /** 根据 modelId 解析 Profile：精确匹配 → 前缀匹配 → 兜底 */
  resolve(modelId: string): ModelProfile {
    // 1. 精确匹配
    const exact = this.profiles.get(modelId);
    if (exact) return exact;

    // 2. 前缀匹配（取最长匹配）
    let bestMatch: ModelProfile | undefined;
    let bestLength = 0;

    for (const profile of this.profiles.values()) {
      if (modelId.startsWith(profile.id) && profile.id.length > bestLength) {
        bestMatch = profile;
        bestLength = profile.id.length;
      }
    }

    if (bestMatch) return bestMatch;

    // 3. 兜底
    return defaultProfile;
  }

  /** 获取所有已注册的 Profile */
  list(): ModelProfile[] {
    return Array.from(this.profiles.values());
  }
}
