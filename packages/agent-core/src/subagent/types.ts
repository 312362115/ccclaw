// ============================================================
// Subagent 类型定义
// ============================================================

import type { TokenUsage } from '../providers/types.js';

/** 子 Agent 角色 — 不同角色使用不同参数和工具集 */
export type SubagentRole = 'coder' | 'reviewer' | 'explorer';

/** 子 Agent 管理配置 */
export interface SubagentConfig {
  /** 最大并发子 Agent 数（默认 3） */
  maxConcurrent: number;
  /** 子 Agent 最大迭代轮次（默认 15） */
  maxIterations: number;
}

/** 子 Agent 执行结果 */
export interface SubagentResult {
  /** 最终文本输出 */
  text: string;
  /** 实际执行的迭代轮次 */
  iterations: number;
  /** token 用量 */
  usage: TokenUsage;
}

/** 角色参数 profile */
export interface RoleProfile {
  temperature: number;
  maxTokens: number;
  systemPromptPrefix: string;
  /** 写入类工具黑名单（reviewer 禁止写入操作） */
  excludeTools?: string[];
}

/** 默认角色 profile 配置 */
export const ROLE_PROFILES: Record<SubagentRole, RoleProfile> = {
  coder: {
    temperature: 0.1,
    maxTokens: 8192,
    systemPromptPrefix: '你是一个编码子 Agent。严格遵循规范，精确实现任务。',
  },
  reviewer: {
    temperature: 0.2,
    maxTokens: 4096,
    systemPromptPrefix: '你是一个审查子 Agent。仔细审查代码改动，发现潜在问题。',
    excludeTools: ['write', 'edit', 'bash'],
  },
  explorer: {
    temperature: 0.3,
    maxTokens: 4096,
    systemPromptPrefix: '你是一个探索子 Agent。广泛搜索信息，分析可能的方案。',
  },
};

/** 默认子 Agent 配置 */
export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  maxConcurrent: 3,
  maxIterations: 15,
};
