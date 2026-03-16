/**
 * Memory 工具 — memory_write / memory_read / memory_search
 *
 * 基于 workspace.db 的分级记忆系统：
 * - decision + feedback → 必注入（全文）
 * - project + reference → 索引（摘要）
 * - log → 搜索（按需查询）
 */

import type { WorkspaceDB } from '../workspace-db.js';
import type { Tool } from '../tool-registry.js';

export function createMemoryTools(db: WorkspaceDB): Tool[] {
  return [
    {
      name: 'memory_write',
      description: '写入工作区记忆。同名记忆会被覆盖（log 类型除外，每次追加新条目）。',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '记忆名称（同名覆盖，log 类型除外）' },
          type: {
            type: 'string',
            description: '记忆类型',
            enum: ['project', 'reference', 'decision', 'feedback', 'log'],
          },
          content: { type: 'string', description: '记忆内容' },
        },
        required: ['name', 'type', 'content'],
      },
      async execute(input) {
        const { name, type, content } = input as {
          name: string;
          type: 'project' | 'reference' | 'decision' | 'feedback' | 'log';
          content: string;
        };
        db.upsertMemory({ name, type, content });
        return `Memory "${name}" (${type}) saved.`;
      },
    },
    {
      name: 'memory_read',
      description: '按名称读取记忆详情，或不传 name 返回分级索引列表。',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '记忆名称（不传则返回索引）' },
        },
      },
      async execute(input) {
        const { name } = input as { name?: string };

        if (name) {
          const mem = db.getMemory(name);
          return mem
            ? `[${mem.type}] ${mem.name}\n${mem.content}`
            : `Memory "${name}" not found.`;
        }

        // 返回分级索引
        const tiers = db.getMemoriesByTier();
        const lines: string[] = [];

        if (tiers.mustInject.length > 0) {
          lines.push('## 行为约束（decision + feedback）');
          for (const m of tiers.mustInject) {
            lines.push(`- [${m.type}] ${m.name}`);
          }
        }

        if (tiers.index.length > 0) {
          lines.push('## 工作区知识（project + reference，使用 memory_read 读取详情）');
          for (const m of tiers.index) {
            lines.push(`- [${m.type}] ${m.name}: ${m.summary}`);
          }
        }

        lines.push(`## 日志（共 ${tiers.search.length} 条，使用 memory_search 搜索）`);

        return lines.join('\n') || '(no memories)';
      },
    },
    {
      name: 'memory_search',
      description: '搜索记忆（关键词匹配 name 和 content）。',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '最大返回条数，默认 5' },
        },
        required: ['query'],
      },
      async execute(input) {
        const { query, limit } = input as { query: string; limit?: number };
        const results = db.searchMemories(query, limit ?? 5);

        if (results.length === 0) return `No memories matching "${query}".`;

        return results
          .map((m) => `[${m.type}] ${m.name}\n${m.content}`)
          .join('\n---\n');
      },
    },
  ];
}
