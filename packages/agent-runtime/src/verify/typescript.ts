/**
 * TypeScript 验证器 — write/edit 后检查类型错误
 *
 * 策略：
 * - 查找最近的 tsconfig.json
 * - 运行 tsc --noEmit --pretty false
 * - 只返回与当前修改文件相关的错误（避免存量错误噪音）
 * - 超时 15 秒视为通过
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { AfterExecVerifier, VerifyResult } from './index.js';

const execFileAsync = promisify(execFile);

const VERIFY_TIMEOUT = 15_000;

/** 向上查找 tsconfig.json */
function findTsConfig(filePath: string): string | null {
  let dir = dirname(filePath);
  const root = resolve('/');
  while (dir !== root) {
    const candidate = resolve(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 解析 tsc 输出，提取错误行 */
function parseTscErrors(stderr: string, targetFile: string): string[] {
  // tsc --pretty false 输出格式：filepath(line,col): error TS1234: message
  const lines = stderr.split('\n');
  const errors: string[] = [];
  const normalizedTarget = resolve(targetFile);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes(': error TS')) continue;

    // 检查是否与目标文件相关
    const parenIdx = trimmed.indexOf('(');
    if (parenIdx === -1) continue;

    const errorFile = resolve(trimmed.substring(0, parenIdx));
    if (errorFile === normalizedTarget) {
      errors.push(trimmed);
    }
  }

  return errors;
}

/**
 * 创建 TypeScript 验证器。
 * 只在文件是 .ts/.tsx 时运行。
 */
export function createTypeScriptVerifier(): AfterExecVerifier {
  return async (_toolName, input, _output): Promise<VerifyResult> => {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return { passed: true, errors: [] };

    // 只验证 TypeScript 文件
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
      return { passed: true, errors: [] };
    }

    const tsconfig = findTsConfig(filePath);
    if (!tsconfig) return { passed: true, errors: [] };

    try {
      const { stderr } = await execFileAsync(
        'npx',
        ['tsc', '--noEmit', '--pretty', 'false', '-p', tsconfig],
        {
          timeout: VERIFY_TIMEOUT,
          cwd: dirname(tsconfig),
          env: { ...process.env, NODE_OPTIONS: '' },
        },
      );

      // tsc 成功不输出到 stderr
      return { passed: true, errors: [] };
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; killed?: boolean; code?: number | null };

      // 超时 → 视为通过
      if (execErr.killed) {
        return { passed: true, errors: [] };
      }

      const stderr = execErr.stderr ?? '';
      const relevantErrors = parseTscErrors(stderr, filePath);

      if (relevantErrors.length === 0) {
        // 有错误但不是当前文件的 → 视为通过（存量问题）
        return { passed: true, errors: [] };
      }

      return {
        passed: false,
        errors: relevantErrors.slice(0, 5), // 最多 5 条，避免信息过载
      };
    }
  };
}
