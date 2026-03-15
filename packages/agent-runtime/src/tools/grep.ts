import { execSync } from 'node:child_process';
import type { Tool } from './index.js';

export const grepTool: Tool = {
  name: 'grep',
  description: '在工作区中搜索文本',
  async execute(input) {
    const { pattern, path = '.' } = input as { pattern: string; path?: string };
    try {
      return execSync(`grep -rn --include='*' '${pattern.replace(/'/g, "'\\''")}' ${path}`, {
        encoding: 'utf-8',
        cwd: process.env.WORKSPACE_DIR ?? '/workspace',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
    } catch (err: any) {
      // grep 无匹配时返回 exit code 1
      if (err.status === 1) return '无匹配结果';
      throw err;
    }
  },
};
