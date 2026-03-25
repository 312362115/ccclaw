/**
 * 通用验证器 — JSON 合法性、括号匹配等基础检查
 *
 * 不依赖外部工具，纯 JS 实现，速度快。
 */

import { readFileSync } from 'node:fs';
import type { AfterExecVerifier, VerifyResult } from './index.js';

/** 检查括号是否匹配 */
function checkBrackets(content: string): string | null {
  const stack: { char: string; line: number }[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const openers = new Set(['(', '[', '{']);
  const closers = new Set([')', ']', '}']);

  let line = 1;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (ch === '\n') line++;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if ((ch === '"' || ch === "'" || ch === '`') && !inString) {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === stringChar && inString) {
      inString = false;
      continue;
    }

    if (inString) continue;

    // 跳过单行注释
    if (ch === '/' && i + 1 < content.length && content[i + 1] === '/') {
      while (i < content.length && content[i] !== '\n') i++;
      line++;
      continue;
    }

    if (openers.has(ch)) {
      stack.push({ char: ch, line });
    } else if (closers.has(ch)) {
      if (stack.length === 0) {
        return `第 ${line} 行：多余的 '${ch}'`;
      }
      const top = stack.pop()!;
      if (top.char !== pairs[ch]) {
        return `第 ${line} 行：'${ch}' 与第 ${top.line} 行的 '${top.char}' 不匹配`;
      }
    }
  }

  if (stack.length > 0) {
    const unmatched = stack[stack.length - 1];
    return `第 ${unmatched.line} 行：'${unmatched.char}' 未闭合`;
  }

  return null;
}

/**
 * 创建 JSON 文件验证器。
 * 只在文件是 .json 时运行。
 */
export function createJsonVerifier(): AfterExecVerifier {
  return async (_toolName, input, _output): Promise<VerifyResult> => {
    const filePath = input.file_path as string | undefined;
    if (!filePath || !filePath.endsWith('.json')) {
      return { passed: true, errors: [] };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      JSON.parse(content);
      return { passed: true, errors: [] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { passed: false, errors: [`JSON 解析错误: ${msg}`] };
    }
  };
}

/**
 * 创建括号匹配验证器。
 * 适用于 .ts/.tsx/.js/.jsx/.py 等文件。
 */
export function createBracketVerifier(): AfterExecVerifier {
  const targetExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs'];

  return async (_toolName, input, _output): Promise<VerifyResult> => {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return { passed: true, errors: [] };

    const hasTargetExt = targetExts.some((ext) => filePath.endsWith(ext));
    if (!hasTargetExt) return { passed: true, errors: [] };

    try {
      const content = readFileSync(filePath, 'utf-8');
      const error = checkBrackets(content);
      if (error) {
        return { passed: false, errors: [`括号不匹配: ${error}`] };
      }
      return { passed: true, errors: [] };
    } catch {
      // 文件读取失败 → 跳过
      return { passed: true, errors: [] };
    }
  };
}
