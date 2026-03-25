/**
 * ModelRouter — 基于 ProfileRegistry 按任务阶段选模型
 *
 * 使用场景：
 * - 规划阶段 → 选 capabilityTier 最高的模型（决策质量优先）
 * - 子 Agent → 选 costEfficiency 最高的模型（速度优先）
 * - 正常编码 → 选 primary 角色的默认模型
 */

import type { ProfileRegistry } from './llm/profiles/index.js';
import type { ModelProfile, AgentPhase, ModelRole } from './llm/model-profile.js';

// ====== ModelRouter ======

export class ModelRouter {
  constructor(
    private registry: ProfileRegistry,
    private defaultVendor?: string,
  ) {}

  /**
   * 根据任务阶段选择最合适的模型。
   *
   * 规划阶段优先能力（选最强），子 Agent 优先性价比（选最便宜）。
   * 如果指定了 defaultVendor，只在该厂商的模型中选。
   */
  selectModel(phase: AgentPhase | 'subagent'): { model: string; profile: ModelProfile } | null {
    const roleMap: Record<string, { role: ModelRole; preference: 'capability' | 'cost' }> = {
      planning: { role: 'planning', preference: 'capability' },
      coding:   { role: 'coding', preference: 'capability' },
      reviewing: { role: 'review', preference: 'capability' },
      subagent: { role: 'subagent', preference: 'cost' },
    };

    const config = roleMap[phase];
    if (!config) return null;

    const profile = this.registry.selectForRole(
      config.role,
      this.defaultVendor,
      config.preference,
    );

    if (!profile) return null;
    return { model: profile.id, profile };
  }

  /**
   * 获取指定模型在指定阶段的推荐参数。
   * 合并 defaults + overrides。
   */
  getParams(modelId: string, phase?: AgentPhase): { temperature: number; maxTokens: number } {
    return this.registry.getPhaseParams(modelId, phase);
  }
}
