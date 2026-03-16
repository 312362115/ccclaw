import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkspaceDB } from '../workspace-db.js';
import { createTodoTools } from './todo.js';
import type { Tool } from '../tool-registry.js';

let db: WorkspaceDB;
let tools: Tool[];
let tmpDir: string;

function getTool(name: string): Tool {
  return tools.find((t) => t.name === name)!;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'todo-test-'));
  db = new WorkspaceDB(join(tmpDir, 'test.db'));
  tools = createTodoTools(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('todo_write', () => {
  it('写入 todos', async () => {
    const result = await getTool('todo_write').execute({
      todos: [
        { content: '任务一', status: 'pending' },
        { content: '任务二', status: 'in_progress' },
      ],
    });
    expect(result).toContain('2 todo(s)');

    const todos = db.getTodos();
    expect(todos).toHaveLength(2);
  });

  it('全量替换', async () => {
    await getTool('todo_write').execute({
      todos: [{ content: '旧任务' }],
    });
    await getTool('todo_write').execute({
      todos: [{ content: '新任务一' }, { content: '新任务二' }],
    });

    const todos = db.getTodos();
    expect(todos).toHaveLength(2);
    expect(todos.map((t) => t.content)).toEqual(['新任务一', '新任务二']);
  });

  it('默认 status 为 pending', async () => {
    await getTool('todo_write').execute({
      todos: [{ content: '无 status' }],
    });
    const todos = db.getTodos();
    expect(todos[0].status).toBe('pending');
  });
});

describe('todo_read', () => {
  it('空列表', async () => {
    const result = await getTool('todo_read').execute({});
    expect(result).toBe('(no todos)');
  });

  it('读取 todos', async () => {
    db.upsertTodo({ content: '任务 A', status: 'pending', session_id: null });
    db.upsertTodo({ content: '任务 B', status: 'completed', session_id: null });

    const result = await getTool('todo_read').execute({});
    expect(result).toContain('[pending] 任务 A');
    expect(result).toContain('[completed] 任务 B');
  });
});
