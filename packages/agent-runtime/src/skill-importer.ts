/**
 * SkillImporter — Claude Code Skill 格式转换器
 *
 * 将 Claude Code 格式的 Skill Markdown 转换为 CCCLaw 格式。
 * 核心 Markdown 内容完全通用，只需补充 CCCLaw 独有的 frontmatter 字段默认值。
 *
 * Claude Code 格式：
 *   ---
 *   name: tdd
 *   description: Test-driven development
 *   ---
 *   content...
 *
 * CCCLaw 格式（补充默认字段）：
 *   ---
 *   name: tdd
 *   description: Test-driven development
 *   trust: sandbox
 *   always: false
 *   ---
 *   content...
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// ====== Types ======

export interface ImportedSkill {
  name: string;
  description: string;
  content: string;
  /** 完整的 CCCLaw 格式 Markdown（含 frontmatter） */
  fullMarkdown: string;
}

export interface ImportResult {
  success: boolean;
  skill?: ImportedSkill;
  error?: string;
}

// ====== Frontmatter 解析 ======

interface ParsedFrontmatter {
  meta: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: markdown };
  }

  const yamlText = match[1];
  const body = match[2];

  // 简单 YAML 解析（只支持 key: value 单层）
  const meta: Record<string, unknown> = {};
  for (const line of yamlText.split('\n')) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (kv) {
      const key = kv[1];
      let val: unknown = kv[2].trim();

      // 布尔值
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      // 数字
      else if (/^\d+$/.test(val as string)) val = parseInt(val as string, 10);
      // 去引号
      else if (typeof val === 'string' && /^['"].*['"]$/.test(val)) {
        val = val.slice(1, -1);
      }

      meta[key] = val;
    }
  }

  return { meta, body };
}

// ====== 格式转换 ======

/**
 * 将 Claude Code 格式的 Skill Markdown 转换为 CCCLaw 格式。
 * 保留原有字段，补充 CCCLaw 独有字段的默认值。
 */
export function convertSkill(markdown: string): ImportResult {
  const { meta, body } = parseFrontmatter(markdown);

  if (!meta.name || typeof meta.name !== 'string') {
    return { success: false, error: 'Skill 缺少 name 字段' };
  }
  if (!meta.description || typeof meta.description !== 'string') {
    return { success: false, error: 'Skill 缺少 description 字段' };
  }

  // 补充 CCCLaw 独有字段默认值
  const ccclawMeta = {
    name: meta.name,
    description: meta.description,
    // 保留 CC 原有字段
    ...(meta.command ? { command: meta.command } : {}),
    // CCCLaw 默认值
    trust: meta.trust ?? 'sandbox',
    always: meta.always ?? false,
    // 其他可选字段透传
    ...(meta.version ? { version: meta.version } : {}),
    ...(meta.sourceUrl ? { sourceUrl: meta.sourceUrl } : {}),
  };

  // 重建 frontmatter
  const frontmatterLines = ['---'];
  for (const [key, val] of Object.entries(ccclawMeta)) {
    if (val === undefined) continue;
    frontmatterLines.push(`${key}: ${typeof val === 'string' ? val : String(val)}`);
  }
  frontmatterLines.push('---');

  const fullMarkdown = frontmatterLines.join('\n') + '\n\n' + body.trim() + '\n';

  return {
    success: true,
    skill: {
      name: meta.name as string,
      description: meta.description as string,
      content: body.trim(),
      fullMarkdown,
    },
  };
}

/**
 * 从 URL 获取 Skill 内容并转换。
 */
export async function importFromUrl(url: string): Promise<ImportResult> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      return { success: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    }
    const markdown = await resp.text();
    return convertSkill(markdown);
  } catch (err) {
    return { success: false, error: `获取失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * 将导入的 Skill 保存到工作区的 skills 目录。
 * 创建 skillName/SKILL.md 文件。
 */
export function saveSkill(skillsDir: string, skill: ImportedSkill): string {
  const dirName = skill.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const skillDir = join(skillsDir, dirName);
  mkdirSync(skillDir, { recursive: true });

  const filePath = join(skillDir, 'SKILL.md');
  writeFileSync(filePath, skill.fullMarkdown, 'utf-8');
  return filePath;
}
