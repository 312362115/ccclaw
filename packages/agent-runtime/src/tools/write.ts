import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Tool } from '../tool-registry.js';

const WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';

export const writeTool: Tool = {
  name: 'write',
  description: '创建或完整覆写工作区文件。如果只需要修改文件的部分内容，请使用 edit 工具。',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作区的文件路径' },
      content: { type: 'string', description: '要写入的完整文件内容' },
    },
    required: ['path', 'content'],
  },
  async execute(input) {
    const { path, content } = input as { path: string; content: string };
    const fullPath = resolve(WORKSPACE, path);

    if (!fullPath.startsWith(resolve(WORKSPACE))) {
      throw new Error('路径越界：禁止访问工作区外的文件');
    }

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
    return `文件已写入: ${path}`;
  },
};
