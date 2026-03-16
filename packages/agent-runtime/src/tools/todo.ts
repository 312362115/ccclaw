/**
 * Todo 工具 — todo_read / todo_write
 *
 * 基于 workspace.db 的任务管理。
 * todo_write 全量替换当前 session 的 todos。
 */

import type { WorkspaceDB } from '../workspace-db.js';
import type { Tool } from '../tool-registry.js';

export function createTodoTools(db: WorkspaceDB): Tool[] {
  return [
    {
      name: 'todo_write',
      description: '更新待办任务列表（全量替换当前 session 的 todos）。',
      schema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Todo 列表，每项包含 content 和 status（pending/in_progress/completed）',
          },
          session_id: { type: 'string', description: '关联的 session ID（可选）' },
        },
        required: ['todos'],
      },
      async execute(input) {
        const { todos, session_id } = input as {
          todos: Array<{ content: string; status?: string }>;
          session_id?: string;
        };

        // 删除当前 session 的所有 todos
        const existing = db.getTodos(session_id);
        for (const t of existing) {
          db.deleteTodo(t.id);
        }

        // 写入新 todos
        for (const t of todos) {
          db.upsertTodo({
            content: t.content,
            status: (t.status as 'pending' | 'in_progress' | 'completed') ?? 'pending',
            session_id: session_id ?? null,
          });
        }

        return `Updated ${todos.length} todo(s).`;
      },
    },
    {
      name: 'todo_read',
      description: '读取当前待办任务列表。',
      schema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: '按 session 过滤（可选）' },
        },
      },
      async execute(input) {
        const { session_id } = input as { session_id?: string };
        const todos = db.getTodos(session_id);

        if (todos.length === 0) return '(no todos)';

        return todos
          .map((t) => `[${t.status}] ${t.content}`)
          .join('\n');
      },
    },
  ];
}
