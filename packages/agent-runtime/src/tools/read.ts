import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool } from '../tool-registry.js';

const WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';

export const readTool: Tool = {
  name: 'read',
  description: '读取工作区文件内容。支持指定起始行和读取行数，适合读取大文件的部分内容。',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作区的文件路径' },
      offset: { type: 'number', description: '起始行号（从 1 开始），不传则从头读' },
      limit: { type: 'number', description: '读取行数，不传则读取全部' },
    },
    required: ['path'],
  },
  async execute(input) {
    const { path, offset, limit } = input as { path: string; offset?: number; limit?: number };
    const fullPath = resolve(WORKSPACE, path);

    if (!fullPath.startsWith(resolve(WORKSPACE))) {
      throw new Error('路径越界：禁止访问工作区外的文件');
    }

    // 检查文件是否存在
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        throw new Error(`${path} 是目录，请使用 glob 工具列出文件`);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') throw new Error(`文件不存在: ${path}`);
      throw err;
    }

    const content = await readFile(fullPath, 'utf-8');

    if (offset == null && limit == null) {
      // 返回带行号的内容
      return addLineNumbers(content);
    }

    const lines = content.split('\n');
    const start = Math.max(0, (offset ?? 1) - 1);
    const end = limit != null ? start + limit : lines.length;
    const slice = lines.slice(start, end);

    return slice.map((line, i) => `${String(start + i + 1).padStart(6)} ${line}`).join('\n');
  },
};

function addLineNumbers(content: string): string {
  const lines = content.split('\n');
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(Math.max(width, 4))} ${line}`).join('\n');
}
