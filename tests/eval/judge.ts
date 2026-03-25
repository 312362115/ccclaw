/**
 * Judge — 验收判断器
 *
 * 对照 EvalCase 的 acceptance 条件，逐项检查是否通过。
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { AcceptanceCheck } from './types.js';

export interface JudgeResult {
  passed: boolean;
  failedChecks: string[];
}

/**
 * 运行所有验收检查。
 * @param checks 验收条件列表
 * @param workDir 工作目录（fixture 解压后的位置）
 */
export function runAcceptanceChecks(checks: AcceptanceCheck[], workDir: string): JudgeResult {
  const failedChecks: string[] = [];

  for (const check of checks) {
    const result = runSingleCheck(check, workDir);
    if (!result.passed) {
      failedChecks.push(result.reason);
    }
  }

  return { passed: failedChecks.length === 0, failedChecks };
}

function runSingleCheck(check: AcceptanceCheck, workDir: string): { passed: boolean; reason: string } {
  switch (check.type) {
    case 'file_exists': {
      const filePath = resolve(workDir, check.file!);
      if (!existsSync(filePath)) {
        return { passed: false, reason: `文件不存在: ${check.file}` };
      }
      return { passed: true, reason: '' };
    }

    case 'file_contains': {
      const filePath = resolve(workDir, check.file!);
      if (!existsSync(filePath)) {
        return { passed: false, reason: `文件不存在: ${check.file}` };
      }
      const content = readFileSync(filePath, 'utf-8');
      const regex = new RegExp(check.pattern!);
      if (!regex.test(content)) {
        return { passed: false, reason: `${check.file} 不包含: ${check.pattern}` };
      }
      return { passed: true, reason: '' };
    }

    case 'file_not_contains': {
      const filePath = resolve(workDir, check.file!);
      if (!existsSync(filePath)) {
        return { passed: true, reason: '' }; // 文件不存在 = 不包含
      }
      const content = readFileSync(filePath, 'utf-8');
      const regex = new RegExp(check.pattern!);
      if (regex.test(content)) {
        return { passed: false, reason: `${check.file} 不应包含: ${check.pattern}` };
      }
      return { passed: true, reason: '' };
    }

    case 'compile_pass': {
      try {
        execSync(check.command!, { cwd: workDir, encoding: 'utf-8', timeout: 30_000 });
        return { passed: true, reason: '' };
      } catch (err: any) {
        return { passed: false, reason: `编译失败: ${err.stderr?.slice(0, 200) || err.message}` };
      }
    }

    case 'command_success': {
      try {
        execSync(check.command!, { cwd: workDir, encoding: 'utf-8', timeout: 30_000 });
        return { passed: true, reason: '' };
      } catch {
        return { passed: false, reason: `命令失败: ${check.command}` };
      }
    }

    case 'output_contains': {
      try {
        const output = execSync(check.command!, { cwd: workDir, encoding: 'utf-8', timeout: 30_000 });
        const regex = new RegExp(check.pattern!);
        if (!regex.test(output)) {
          return { passed: false, reason: `命令输出不包含: ${check.pattern}` };
        }
        return { passed: true, reason: '' };
      } catch (err: any) {
        return { passed: false, reason: `命令执行失败: ${err.message}` };
      }
    }

    default:
      return { passed: false, reason: `未知检查类型: ${(check as any).type}` };
  }
}
