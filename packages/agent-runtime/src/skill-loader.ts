/**
 * SkillLoader — Skill 加载与分类
 *
 * 三类 Skill：
 * - knowledge: 纯知识型，注入到 system prompt
 * - executable_declared: 声明式可执行（有 command 字段），注册为工具
 * - executable_implicit: 隐式可执行（无 command 但包含执行指令），标记警告
 *
 * 目录结构：每个 Skill 是一个目录，包含 SKILL.md（frontmatter + 内容）
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolRegistry, Tool } from './tool-registry.js';
import type { ISkillLoader } from './context-assembler.js';

// ====== Types ======

export interface SkillMeta {
  name: string;
  description: string;
  command?: string;
  confirm?: boolean;
  timeout?: number;
  workdir?: 'home' | 'internal';
  always?: boolean;
  trust?: 'sandbox' | 'prompt' | 'trusted';
  requires?: {
    bins?: string[];
    env?: string[];
    runtime?: string;
    deps?: string;
  };
  setup?: string;
}

export type SkillType = 'knowledge' | 'executable_declared' | 'executable_implicit';

export interface LoadedSkill {
  meta: SkillMeta;
  type: SkillType;
  content: string;
  dir: string;
  available: boolean;
  missingReason?: string;
}

// ====== Constants ======

const EXEC_PATTERNS = [
  /```(?:bash|sh|shell|python|node)\b/i,
  /\bpython\s+scripts?\//i,
  /\bbash\s+-c\b/i,
  /\bcurl\s+.*\|\s*(?:bash|sh)\b/i,
  /\bnpm\s+(?:run|exec)\b/i,
];

/** 高风险执行模式（安全扫描用） */
const HIGH_RISK_PATTERNS = [
  { pattern: /\bchmod\s+\+x\b/i, label: 'chmod +x' },
  { pattern: /\bcurl\b.*\|\s*(?:bash|sh)\b/i, label: 'curl pipe to shell' },
  { pattern: /\beval\s*\(/i, label: 'eval()' },
  { pattern: /\bexec\s*\(/i, label: 'exec()' },
  { pattern: /\brm\s+-rf\s+\//i, label: 'rm -rf /' },
  { pattern: /\bsudo\b/i, label: 'sudo' },
  { pattern: /ignore\s+previous\s+instructions/i, label: 'prompt injection' },
  { pattern: /you\s+are\s+now\s+(?:a|an|in)\b/i, label: 'role hijack' },
  { pattern: /\bpasswd\b/i, label: 'passwd access' },
  { pattern: /\b\/etc\/shadow\b/i, label: '/etc/shadow access' },
];

export interface SecurityReport {
  safe: boolean;
  risks: Array<{ pattern: string; line: number }>;
}

// ====== SkillLoader ======

export class SkillLoader implements ISkillLoader {
  private skills: LoadedSkill[] = [];

  constructor(
    private skillsDirs: string[],
    private toolRegistry: ToolRegistry,
    private homeDir: string,
  ) {}

  /** 扫描所有 Skill 目录，解析 SKILL.md */
  loadAll(): LoadedSkill[] {
    this.skills = [];

    for (const dir of this.skillsDirs) {
      if (!existsSync(dir)) continue;

      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = join(dir, entry.name);
        const skillFile = join(skillDir, 'SKILL.md');
        if (!existsSync(skillFile)) continue;

        try {
          const raw = readFileSync(skillFile, 'utf-8');
          const { meta, content } = parseFrontmatter(raw);

          if (!meta.name) meta.name = entry.name;
          if (!meta.description) meta.description = '';

          const type = this.classifySkill(meta, content);
          const { ok, reason } = this.checkRequires(meta.requires, skillDir);

          this.skills.push({
            meta,
            type,
            content,
            dir: skillDir,
            available: ok,
            missingReason: reason,
          });
        } catch {
          // 解析失败跳过
        }
      }
    }

    return this.skills;
  }

  /** 获取 always=true 的 Skill 全文内容 */
  getAlwaysActiveContent(): string {
    return this.skills
      .filter((s) => s.meta.always && s.available)
      .map((s) => `## Skill: ${s.meta.name}\n${s.content}`)
      .join('\n\n');
  }

  /** 获取非 always Skill 的 XML 摘要 */
  getSummaryXML(): string {
    const nonAlways = this.skills.filter((s) => !s.meta.always && s.available);
    if (nonAlways.length === 0) return '';

    const lines = nonAlways.map(
      (s) => `  <skill name="${s.meta.name}" type="${s.type}">${s.meta.description}</skill>`,
    );
    return `<skills count="${nonAlways.length}">\n${lines.join('\n')}\n</skills>`;
  }

  /** 将声明式可执行 Skill 注册到 ToolRegistry */
  registerExecutableSkills(): void {
    for (const skill of this.skills) {
      if (skill.type !== 'executable_declared' || !skill.available) continue;
      if (!skill.meta.command) continue;

      const { meta, content, dir } = skill;
      const homeDir = this.homeDir;

      const tool: Tool = {
        name: `skill_${meta.name}`,
        description: content,
        async execute(input) {
          const args = (input as { args?: string }).args ?? '';
          const cwd = meta.workdir === 'internal' ? dir : homeDir;
          const result = execSync(`${meta.command} ${args}`, {
            cwd,
            timeout: meta.timeout ?? 120_000,
            encoding: 'utf-8',
            maxBuffer: 1024 * 1024,
          });
          return result;
        },
      };

      this.toolRegistry.register(tool);
    }
  }

  /** 获取加载的 Skill 列表 */
  getSkills(): LoadedSkill[] {
    return this.skills;
  }

  /**
   * 安装 Skill 依赖
   * 支持 setup 脚本、requirements.txt、package.json
   */
  installDeps(skill: LoadedSkill): { ok: boolean; error?: string } {
    if (!skill.meta.requires?.deps && !skill.meta.setup) {
      return { ok: true };
    }

    try {
      if (skill.meta.setup) {
        // 自定义安装脚本
        const setupPath = join(skill.dir, skill.meta.setup);
        if (!existsSync(setupPath)) {
          return { ok: false, error: `setup 脚本不存在: ${skill.meta.setup}` };
        }
        execSync(`bash ${setupPath}`, {
          cwd: skill.dir,
          timeout: 120_000,
          encoding: 'utf-8',
        });
        return { ok: true };
      }

      if (skill.meta.requires?.deps) {
        const depsFile = skill.meta.requires.deps;
        const depsPath = join(skill.dir, depsFile);
        if (!existsSync(depsPath)) {
          return { ok: false, error: `依赖文件不存在: ${depsFile}` };
        }

        if (depsFile.endsWith('requirements.txt')) {
          execSync(`pip install -r ${depsPath}`, {
            cwd: skill.dir,
            timeout: 120_000,
            encoding: 'utf-8',
          });
        } else if (depsFile.endsWith('package.json')) {
          execSync('npm install --no-audit --no-fund', {
            cwd: skill.dir,
            timeout: 120_000,
            encoding: 'utf-8',
          });
        } else {
          return { ok: false, error: `不支持的依赖文件类型: ${depsFile}` };
        }

        return { ok: true };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /** 安全扫描 Skill 内容，检测高风险模式 */
  scanSecurity(skill: LoadedSkill): SecurityReport {
    const risks: SecurityReport['risks'] = [];
    const lines = skill.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { pattern, label } of HIGH_RISK_PATTERNS) {
        if (pattern.test(line)) {
          risks.push({ pattern: label, line: i + 1 });
        }
      }
    }

    return { safe: risks.length === 0, risks };
  }

  /** Skill 分类 */
  private classifySkill(meta: SkillMeta, content: string): SkillType {
    if (meta.command) return 'executable_declared';
    if (EXEC_PATTERNS.some((p) => p.test(content))) return 'executable_implicit';
    return 'knowledge';
  }

  /** 检查 requires 依赖 */
  private checkRequires(
    requires: SkillMeta['requires'],
    _skillDir: string,
  ): { ok: boolean; reason?: string } {
    if (!requires) return { ok: true };

    // 检查必要的二进制
    if (requires.bins) {
      for (const bin of requires.bins) {
        try {
          execSync(`which ${bin}`, { encoding: 'utf-8', timeout: 5000 });
        } catch {
          return { ok: false, reason: `缺少命令: ${bin}` };
        }
      }
    }

    // 检查环境变量
    if (requires.env) {
      for (const key of requires.env) {
        if (!process.env[key]) {
          return { ok: false, reason: `缺少环境变量: ${key}` };
        }
      }
    }

    // 检查 runtime 版本（简化实现）
    if (requires.runtime) {
      const match = requires.runtime.match(/^(\w+)>=(.+)$/);
      if (match) {
        const [, cmd, minVersion] = match;
        try {
          const version = execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 5000 })
            .trim()
            .replace(/^[^0-9]*/, '');
          if (!satisfiesVersion(version, minVersion)) {
            return { ok: false, reason: `${cmd} 版本 ${version} < ${minVersion}` };
          }
        } catch {
          return { ok: false, reason: `无法执行 ${cmd} --version` };
        }
      }
    }

    return { ok: true };
  }
}

// ====== Helpers ======

/** 简单 frontmatter 解析（不依赖 gray-matter） */
export function parseFrontmatter(raw: string): { meta: SkillMeta; content: string } {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    return { meta: { name: '', description: '' }, content: raw };
  }

  const [, yamlBlock, content] = fmMatch;
  const meta: Record<string, unknown> = {};

  // 简单 YAML 解析（仅支持 key: value 和 key:\n  - item 格式）
  let currentKey = '';
  let currentArray: string[] | null = null;

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const arrayItem = trimmed.match(/^-\s+(.+)$/);
    if (arrayItem && currentArray) {
      currentArray.push(arrayItem[1]);
      continue;
    }

    // 保存上一个数组
    if (currentArray && currentKey) {
      meta[currentKey] = currentArray;
      currentArray = null;
    }

    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      currentKey = key;
      if (value === '') {
        // 可能是数组或嵌套对象开始
        currentArray = [];
      } else {
        // 解析值
        meta[key] = parseYamlValue(value);
      }
    }
  }

  // 保存最后一个数组
  if (currentArray && currentKey) {
    meta[currentKey] = currentArray;
  }

  return { meta: meta as unknown as SkillMeta, content: content.trim() };
}

function parseYamlValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!Number.isNaN(num) && value !== '') return num;
  // 去掉引号
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** 简单语义版本比较（major.minor） */
export function satisfiesVersion(current: string, minimum: string): boolean {
  const parseSemver = (v: string) => {
    const parts = v.split('.').map(Number);
    return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
  };

  const cur = parseSemver(current);
  const min = parseSemver(minimum);

  if (cur.major !== min.major) return cur.major > min.major;
  if (cur.minor !== min.minor) return cur.minor > min.minor;
  return cur.patch >= min.patch;
}
