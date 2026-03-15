import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Tool } from './index.js';

const WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';

export const fileTool: Tool = {
  name: 'file',
  description: '读写工作区文件',
  async execute(input) {
    const { action, path, content } = input as { action: 'read' | 'write'; path: string; content?: string };
    const fullPath = resolve(WORKSPACE, path);

    if (!fullPath.startsWith(resolve(WORKSPACE))) {
      throw new Error('路径越界：禁止访问工作区外的文件');
    }

    if (action === 'read') {
      return await readFile(fullPath, 'utf-8');
    }

    if (action === 'write' && content != null) {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
      return `文件已写入: ${path}`;
    }

    throw new Error(`不支持的操作: ${action}`);
  },
};
