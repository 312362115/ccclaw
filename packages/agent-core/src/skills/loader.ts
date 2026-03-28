// ============================================================
// SkillLoader — 双模 Skill 加载器
//
// 职责：
// 1. 从目录扫描 SKILL.md（YAML frontmatter + Markdown body）
// 2. 接受编程方式注册的 inline Skill
// 3. 按模型能力分层解析 prompt
// 4. 收集工具和钩子注册
// ============================================================

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '../tools/types.js';
import type { Skill, PromptSkill, CodeSkill, SkillLoaderConfig, SkillHookResult } from './types.js';

// ====== Frontmatter 解析（复用 agent-runtime 的模式） ======

interface SkillFrontmatter {
  name?: string;
  description?: string;
  type?: 'prompt' | 'code';
  always?: boolean;
}

/**
 * 简单 frontmatter 解析（不依赖 gray-matter）
 * 格式：--- 开头，--- 结尾，中间是 key: value
 */
export function parseFrontmatter(raw: string): { meta: SkillFrontmatter; content: string } {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    return { meta: {}, content: raw };
  }

  const [, yamlBlock, content] = fmMatch;
  const meta: Record<string, unknown> = {};

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      meta[key] = parseYamlValue(value);
    }
  }

  return { meta: meta as unknown as SkillFrontmatter, content: content.trim() };
}

function parseYamlValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!Number.isNaN(num) && value !== '') return num;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// ====== 能力分层 prompt 解析 ======

/**
 * 根据 capabilityTier 选择最合适的 prompt 文本
 * - strong: capabilityTier >= 5
 * - medium: capabilityTier 3-4
 * - weak: capabilityTier <= 2
 * 如果对应层级没有变体，回退到 skill.prompt
 */
export function resolvePrompt(skill: Skill, capabilityTier: number): string {
  const tiers = skill.promptByTier;
  if (!tiers) return skill.prompt;

  if (capabilityTier >= 5 && tiers.strong) return tiers.strong;
  if (capabilityTier >= 3 && capabilityTier <= 4 && tiers.medium) return tiers.medium;
  if (capabilityTier <= 2 && tiers.weak) return tiers.weak;

  return skill.prompt;
}

// ====== SkillLoader ======

export class SkillLoader {
  private skills: Skill[] = [];
  private config: SkillLoaderConfig;

  constructor(config: SkillLoaderConfig) {
    this.config = config;
  }

  /** 扫描目录 + 注册 inline Skill */
  loadAll(): void {
    this.skills = [];

    // 1. 从目录加载 SKILL.md
    if (this.config.dirs) {
      for (const dir of this.config.dirs) {
        this.loadFromDirectory(dir);
      }
    }

    // 2. 注册 inline Skill
    if (this.config.inline) {
      for (const skill of this.config.inline) {
        this.skills.push(skill);
      }
    }
  }

  /** 获取所有 always=true 的 Skill prompt（按 capabilityTier 解析） */
  getPromptContent(capabilityTier: number): string {
    return this.skills
      .filter((s) => s.always)
      .map((s) => `## Skill: ${s.name}\n${resolvePrompt(s, capabilityTier)}`)
      .join('\n\n');
  }

  /** 获取非 always Skill 的 XML 摘要 */
  getSkillSummaryXML(): string {
    const nonAlways = this.skills.filter((s) => !s.always);
    if (nonAlways.length === 0) return '';

    const lines = nonAlways.map(
      (s) => `  <skill name="${s.name}" type="${s.type}">${s.description}</skill>`,
    );
    return `<skills count="${nonAlways.length}">\n${lines.join('\n')}\n</skills>`;
  }

  /** 收集所有 Skill 提供的工具 */
  getTools(): Tool[] {
    const tools: Tool[] = [];
    for (const skill of this.skills) {
      if (skill.tools) {
        tools.push(...skill.tools);
      }
    }
    return tools;
  }

  /** 收集所有 Code Skill 的钩子 */
  getHooks(): {
    beforeToolCall: Array<
      (toolName: string, input: Record<string, unknown>, state: Map<string, unknown>) => Promise<SkillHookResult>
    >;
    afterToolCall: Array<
      (toolName: string, input: Record<string, unknown>, result: string, state: Map<string, unknown>) => Promise<void>
    >;
  } {
    const beforeToolCall: Array<
      (toolName: string, input: Record<string, unknown>, state: Map<string, unknown>) => Promise<SkillHookResult>
    > = [];
    const afterToolCall: Array<
      (toolName: string, input: Record<string, unknown>, result: string, state: Map<string, unknown>) => Promise<void>
    > = [];

    for (const skill of this.skills) {
      if (skill.type === 'code') {
        const codeSkill = skill as CodeSkill;
        if (codeSkill.hooks.beforeToolCall) {
          beforeToolCall.push(codeSkill.hooks.beforeToolCall);
        }
        if (codeSkill.hooks.afterToolCall) {
          afterToolCall.push(codeSkill.hooks.afterToolCall);
        }
      }
    }

    return { beforeToolCall, afterToolCall };
  }

  /** 获取所有已加载的 Skill */
  getSkills(): Skill[] {
    return [...this.skills];
  }

  // ====== 内部方法 ======

  private loadFromDirectory(dir: string): void {
    if (!existsSync(dir)) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      try {
        const raw = readFileSync(skillFile, 'utf-8');
        const { meta, content } = parseFrontmatter(raw);

        const skill: PromptSkill = {
          type: (meta.type as 'prompt') ?? 'prompt',
          name: meta.name ?? entry.name,
          description: meta.description ?? '',
          prompt: content,
          always: meta.always ?? false,
        };

        this.skills.push(skill);
      } catch {
        // 解析失败跳过
      }
    }
  }
}
