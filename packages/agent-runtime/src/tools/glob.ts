import { readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { Tool } from './index.js';

const WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';

export const globTool: Tool = {
  name: 'glob',
  description: '按模式搜索文件',
  async execute(input) {
    const { pattern } = input as { pattern: string };
    // 简单实现：递归列出文件，前端侧用 pattern 过滤
    const files = await listFiles(resolve(WORKSPACE), pattern);
    return files.join('\n');
  },
};

async function listFiles(dir: string, pattern: string, result: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      await listFiles(fullPath, pattern, result);
    } else if (entry.isFile()) {
      const rel = relative(resolve(WORKSPACE), fullPath);
      // 简单匹配：pattern 中的 * 转为正则
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      if (regex.test(rel) || regex.test(entry.name)) {
        result.push(rel);
      }
    }
  }
  return result;
}
