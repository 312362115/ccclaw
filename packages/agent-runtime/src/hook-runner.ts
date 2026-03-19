/**
 * HookRunner — 工具执行前后触发用户定义的脚本
 *
 * 配置文件：.ccclaw/hooks.json
 *
 * 示例配置：
 * {
 *   "hooks": [
 *     {
 *       "event": "after",
 *       "tools": ["edit", "write"],
 *       "command": "npx prettier --write ${path}",
 *       "timeout": 10000
 *     },
 *     {
 *       "event": "before",
 *       "tools": ["bash"],
 *       "command": "echo 'Running: ${command}'",
 *       "timeout": 5000
 *     }
 *   ]
 * }
 *
 * 变量替换：hook command 中的 ${key} 会被替换为工具参数中的同名值。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

// ====== Types ======

export interface HookConfig {
  event: 'before' | 'after';
  tools: string[];         // 匹配的工具名（支持 '*' 通配全部）
  command: string;         // 要执行的 shell 命令（支持 ${param} 变量替换）
  timeout?: number;        // 超时毫秒，默认 10000
}

interface HooksFile {
  hooks: HookConfig[];
}

// ====== HookRunner ======

export class HookRunner {
  private hooks: HookConfig[] = [];
  private workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    this.loadConfig();
  }

  /** 从 .ccclaw/hooks.json 加载配置 */
  loadConfig(): void {
    const configPath = join(this.workspaceDir, '.ccclaw', 'hooks.json');
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed: HooksFile = JSON.parse(raw);
      if (Array.isArray(parsed.hooks)) {
        this.hooks = parsed.hooks.filter(
          (h) => (h.event === 'before' || h.event === 'after') && Array.isArray(h.tools) && typeof h.command === 'string',
        );
        if (this.hooks.length > 0) {
          logger.info({ count: this.hooks.length }, 'Hook 配置已加载');
        }
      }
    } catch {
      // 配置文件不存在或格式错误，静默跳过
      this.hooks = [];
    }
  }

  /** 是否有任何 hook 配置 */
  get hasHooks(): boolean {
    return this.hooks.length > 0;
  }

  /**
   * 执行匹配的 hook
   * @returns hook 输出（如有），失败时返回 null（不阻塞主流程）
   */
  async run(
    event: 'before' | 'after',
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<string | null> {
    const matched = this.hooks.filter(
      (h) => h.event === event && (h.tools.includes(toolName) || h.tools.includes('*')),
    );

    if (matched.length === 0) return null;

    const outputs: string[] = [];

    for (const hook of matched) {
      try {
        const cmd = substituteParams(hook.command, params);
        const timeout = hook.timeout ?? 10_000;

        const { stdout, stderr } = await execFileAsync('sh', ['-c', cmd], {
          cwd: this.workspaceDir,
          timeout,
          env: {
            ...process.env,
            HOOK_EVENT: event,
            HOOK_TOOL: toolName,
          },
        });

        const output = (stdout + stderr).trim();
        if (output) {
          outputs.push(output);
        }
      } catch (err: any) {
        // hook 失败不阻塞工具执行，只记录日志
        const msg = err.killed ? `Hook 超时被终止` : (err.message || String(err));
        logger.warn({ event, tool: toolName, error: msg }, 'Hook 执行失败');

        // before hook 失败时返回错误信息，让 Agent 知道
        if (event === 'before') {
          return `[Hook 警告] ${msg}`;
        }
      }
    }

    return outputs.length > 0 ? outputs.join('\n') : null;
  }
}

/**
 * 将命令中的 ${key} 替换为 params 中的同名值
 * 未匹配的变量保持原样
 */
function substituteParams(command: string, params: Record<string, unknown>): string {
  return command.replace(/\$\{(\w+)\}/g, (match, key) => {
    const val = params[key];
    if (val === undefined || val === null) return match;
    // 对字符串值进行 shell 转义
    const str = String(val);
    return str.replace(/'/g, "'\\''");
  });
}
