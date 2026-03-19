import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool } from '../tool-registry.js';

const WORKSPACE = process.env.WORKSPACE_DIR ?? '/workspace';

export const editTool: Tool = {
  name: 'edit',
  description: '精准编辑文件：将文件中的指定文本替换为新文本。只传输差异部分，适合修改大文件。old_string 必须在文件中唯一匹配（除非 replace_all=true）。',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对于工作区的文件路径' },
      old_string: { type: 'string', description: '要被替换的原始文本（必须精确匹配文件中的内容）' },
      new_string: { type: 'string', description: '替换后的新文本' },
      replace_all: { type: 'boolean', description: '是否替换所有匹配项（默认 false，仅替换第一个唯一匹配）' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  async execute(input) {
    const { path, old_string, new_string, replace_all } = input as {
      path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    };
    const fullPath = resolve(WORKSPACE, path);

    if (!fullPath.startsWith(resolve(WORKSPACE))) {
      throw new Error('路径越界：禁止访问工作区外的文件');
    }

    if (old_string === new_string) {
      throw new Error('old_string 和 new_string 相同，无需替换');
    }

    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') throw new Error(`文件不存在: ${path}`);
      throw err;
    }

    // 检查匹配
    const occurrences = countOccurrences(content, old_string);

    if (occurrences === 0) {
      throw new Error(`在 ${path} 中未找到匹配的文本。请确保 old_string 与文件内容完全一致（包括缩进和空白字符）。`);
    }

    if (!replace_all && occurrences > 1) {
      throw new Error(
        `在 ${path} 中找到 ${occurrences} 处匹配。请提供更多上下文使 old_string 唯一，或设置 replace_all=true 替换所有匹配。`
      );
    }

    // 执行替换
    let updated: string;
    if (replace_all) {
      updated = content.split(old_string).join(new_string);
    } else {
      const idx = content.indexOf(old_string);
      updated = content.slice(0, idx) + new_string + content.slice(idx + old_string.length);
    }

    await writeFile(fullPath, updated, 'utf-8');

    const replaced = replace_all ? occurrences : 1;
    return `文件已更新: ${path}（替换了 ${replaced} 处）`;
  },
};

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}
