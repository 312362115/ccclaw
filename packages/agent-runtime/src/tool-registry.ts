/**
 * ToolRegistry — 统一工具注册表
 *
 * 管理三层工具：内置工具 + 可执行 Skill + MCP 工具。
 * 提供统一的注册、查询、执行接口。
 */

import type { HookRunner } from './hook-runner.js';
import { resolve } from 'node:path';

// ====== Types ======

export interface ToolSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema?: ToolSchema;
}

export interface Tool {
  name: string;
  description: string;
  schema?: ToolSchema;
  execute(input: Record<string, unknown>): Promise<string>;
}

// ====== Constants ======

const MAX_TOOL_RESULT_CHARS = 16_000;

// ====== ToolRegistry ======

export type GuardDecision = 'allow' | 'block' | 'confirm';

export interface GuardResult {
  decision: GuardDecision;
  reason?: string;
}

/** 请求用户确认的回调，返回 true = 允许 */
export type ConfirmCallback = (toolName: string, input: unknown, reason: string) => Promise<boolean>;

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private restrictedTools: Set<string> | null = null;
  private hookRunner: HookRunner | null = null;
  private confirmCallback: ConfirmCallback | null = null;

  /** 设置 Hook Runner（工具执行前后触发用户脚本） */
  setHookRunner(runner: HookRunner): void {
    this.hookRunner = runner;
  }

  /** 设置确认回调（用于 ToolGuard 需要用户审批的场景） */
  setConfirmCallback(cb: ConfirmCallback): void {
    this.confirmCallback = cb;
  }

  /** 注册一个工具 */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** 批量注册 MCP 工具（命名：mcp_{serverName}_{toolName}） */
  registerMCP(serverName: string, tools: Tool[]): void {
    for (const tool of tools) {
      const prefixed: Tool = {
        ...tool,
        name: `mcp_${serverName}_${tool.name}`,
      };
      this.tools.set(prefixed.name, prefixed);
    }
  }

  /** 注销工具 */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** 获取所有工具定义（用于 LLM tool_choice） */
  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, schema }) => ({
      name,
      description,
      schema,
    }));
  }

  /** 获取工具名列表 */
  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  /** 检查工具是否存在 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 获取工具实例 */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 获取工具数量 */
  get size(): number {
    return this.tools.size;
  }

  /** 进入受限模式，只允许指定工具执行 */
  enterRestrictedMode(allowedTools: string[]): void {
    this.restrictedTools = new Set(allowedTools);
  }

  /** 退出受限模式，恢复所有工具 */
  exitRestrictedMode(): void {
    this.restrictedTools = null;
  }

  /** 执行工具，返回结果字符串 */
  async execute(name: string, params: Record<string, unknown>): Promise<string> {
    if (this.restrictedTools && !this.restrictedTools.has(name)) {
      return `Error: Tool "${name}" is not available during context consolidation. Only memory tools are allowed.`;
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Unknown tool "${name}"\n\nAvailable tools: ${this.getToolNames().join(', ')}`;
    }

    try {
      const casted = tool.schema ? castParams(params, tool.schema) : params;

      // ToolGuard 安全检查
      const guard = checkToolUse(name, casted, process.env.WORKSPACE_DIR ?? '/workspace');
      if (guard.decision === 'block') {
        return `Error: 操作被安全策略拦截 — ${guard.reason}`;
      }
      if (guard.decision === 'confirm') {
        if (this.confirmCallback) {
          const approved = await this.confirmCallback(name, casted, guard.reason ?? '需要确认');
          if (!approved) {
            return `Error: 用户拒绝了操作 — ${guard.reason}`;
          }
        }
        // 没有 confirmCallback 时放行（单元测试等场景）
      }

      // Before hook
      if (this.hookRunner?.hasHooks) {
        const hookResult = await this.hookRunner.run('before', name, casted);
        if (hookResult) {
          // before hook 返回内容时附加到结果前面
        }
      }

      let result = await tool.execute(casted);

      // After hook
      if (this.hookRunner?.hasHooks) {
        const hookResult = await this.hookRunner.run('after', name, casted);
        if (hookResult) {
          result += `\n[Hook] ${hookResult}`;
        }
      }

      if (result.length > MAX_TOOL_RESULT_CHARS) {
        result = result.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...(truncated)';
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}\n\nAnalyze the error above and try a different approach.`;
    }
  }
}

// ====== Parameter Casting ======

/**
 * 根据 schema 将 LLM 传来的字符串参数转换为正确类型。
 * LLM 有时会将 number/boolean 以字符串形式传递。
 */
export function castParams(
  params: Record<string, unknown>,
  schema: ToolSchema,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...params };

  for (const [key, def] of Object.entries(schema.properties)) {
    if (!(key in result)) continue;
    const val = result[key];
    if (val === undefined || val === null) continue;

    switch (def.type) {
      case 'number':
      case 'integer':
        if (typeof val === 'string') {
          const num = Number(val);
          if (!Number.isNaN(num)) result[key] = num;
        }
        break;
      case 'boolean':
        if (typeof val === 'string') {
          if (val === 'true') result[key] = true;
          else if (val === 'false') result[key] = false;
        }
        break;
      case 'array':
        if (typeof val === 'string') {
          try { result[key] = JSON.parse(val); } catch { /* 保持原值 */ }
        }
        break;
      case 'object':
        if (typeof val === 'string') {
          try { result[key] = JSON.parse(val); } catch { /* 保持原值 */ }
        }
        break;
    }
  }

  return result;
}

// ====== ToolGuard — 安全拦截 ======

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[a-z]*)?r[a-z]*\s+\/($|\s)/, reason: '禁止删除根目录' },
  { pattern: /rm\s+(-[a-z]*)?r[a-z]*f[a-z]*\s+\/($|\s)/, reason: '禁止 rm -rf /' },
  { pattern: /mkfs/, reason: '禁止格式化磁盘' },
  { pattern: /dd\s+if=.*of=\/dev/, reason: '禁止直接写入设备' },
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/, reason: '禁止从网络下载并执行脚本' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/, reason: '禁止从网络下载并执行脚本' },
  { pattern: /chmod\s+777/, reason: '禁止设置过于宽松的权限' },
  { pattern: />\s*\/etc\//, reason: '禁止写入系统配置文件' },
];

const CONFIRM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /git\s+push\s+.*--force/, reason: 'force push 可能覆盖远程历史' },
  { pattern: /git\s+push\s+-f/, reason: 'force push 可能覆盖远程历史' },
  { pattern: /git\s+reset\s+--hard/, reason: 'hard reset 会丢弃未提交的更改' },
  { pattern: /git\s+clean\s+-f/, reason: '会删除未跟踪的文件' },
  { pattern: /npm\s+publish/, reason: '发布包到 npm' },
  { pattern: /DROP\s+TABLE|DROP\s+DATABASE/i, reason: '执行数据库删除操作' },
  { pattern: /TRUNCATE\s+TABLE/i, reason: '清空数据表' },
  { pattern: /rm\s+(-[a-z]*)?r/, reason: '递归删除文件' },
];

const SENSITIVE_FILE_PATTERNS = [
  /\.env$/,
  /\.ssh\//,
  /id_rsa/,
  /credentials/i,
  /secrets?\./i,
];

export function checkToolUse(
  toolName: string,
  input: Record<string, unknown>,
  workspaceDir: string,
): GuardResult {
  // bash 命令检查
  if (toolName === 'bash' && typeof input.command === 'string') {
    const cmd = input.command;
    for (const rule of BLOCKED_PATTERNS) {
      if (rule.pattern.test(cmd)) return { decision: 'block', reason: rule.reason };
    }
    for (const rule of CONFIRM_PATTERNS) {
      if (rule.pattern.test(cmd)) return { decision: 'confirm', reason: rule.reason };
    }
  }

  // 文件路径检查（read / write / edit）
  if (['read', 'write', 'edit'].includes(toolName) && typeof input.path === 'string') {
    const filePath = input.path;
    for (const pattern of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(filePath)) return { decision: 'confirm', reason: `访问敏感文件: ${filePath}` };
    }
    const resolved = resolve(workspaceDir, filePath);
    if (!resolved.startsWith(resolve(workspaceDir))) {
      return { decision: 'block', reason: '路径越界：禁止访问工作区外的文件' };
    }
  }

  return { decision: 'allow' };
}
