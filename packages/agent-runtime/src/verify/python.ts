/**
 * Python 语法验证器 — 使用 ast.parse 检查语法正确性
 *
 * 不检查类型（Python 没有原生 typecheck），只检查语法能否解析。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AfterExecVerifier, VerifyResult } from './index.js';

const execFileAsync = promisify(execFile);

const VERIFY_TIMEOUT = 5_000;

/**
 * 创建 Python 语法验证器。
 * 只在文件是 .py 时运行。
 */
export function createPythonVerifier(): AfterExecVerifier {
  return async (_toolName, input, _output): Promise<VerifyResult> => {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return { passed: true, errors: [] };

    if (!filePath.endsWith('.py')) {
      return { passed: true, errors: [] };
    }

    try {
      await execFileAsync(
        'python3',
        ['-c', `import ast; ast.parse(open(${JSON.stringify(filePath)}).read())`],
        { timeout: VERIFY_TIMEOUT },
      );
      return { passed: true, errors: [] };
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; killed?: boolean };

      if (execErr.killed) {
        return { passed: true, errors: [] };
      }

      const stderr = execErr.stderr ?? '';
      // Python SyntaxError 输出格式：SyntaxError: ... (file, line N)
      const errorLine = stderr.split('\n').find((l) => l.includes('SyntaxError'));
      return {
        passed: false,
        errors: [errorLine || `Python 语法错误: ${stderr.slice(0, 200)}`],
      };
    }
  };
}
