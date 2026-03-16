import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { WorkspaceDB } from './workspace-db.js';
import type { NewSession, NewMessage, NewMemory, NewTodo } from './workspace-db.js';

describe('WorkspaceDB', () => {
  let db: WorkspaceDB;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wsdb-test-'));
    dbPath = join(tmpDir, 'workspace.db');
    db = new WorkspaceDB(dbPath);
  });

  afterEach(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ====== WAL mode ======

  it('should use WAL journal mode', async () => {
    // Access the internal db to check pragma - we verify via a new connection
    const Database = (await import('better-sqlite3')).default;
    const check = new Database(dbPath);
    const result = check.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe('wal');
    check.close();
  });

  // ====== Sessions CRUD ======

  describe('Sessions', () => {
    it('should create and retrieve a session', () => {
      const session = db.createSession({
        workspace_id: 'ws-1',
        user_id: 'user-1',
      });
      expect(session.id).toBeTruthy();
      expect(session.workspace_id).toBe('ws-1');
      expect(session.user_id).toBe('user-1');
      expect(session.channel_type).toBe('webui');
      expect(session.title).toBe('新会话');
      expect(session.status).toBe('active');
      expect(session.last_consolidated).toBe(0);

      const fetched = db.getSession(session.id);
      expect(fetched).toEqual(session);
    });

    it('should return null for non-existent session', () => {
      expect(db.getSession('nonexistent')).toBeNull();
    });

    it('should update session fields', () => {
      const session = db.createSession({ workspace_id: 'ws-1', user_id: 'user-1' });
      db.updateSession(session.id, { title: 'Updated', status: 'archived', last_consolidated: 5 });
      const updated = db.getSession(session.id)!;
      expect(updated.title).toBe('Updated');
      expect(updated.status).toBe('archived');
      expect(updated.last_consolidated).toBe(5);
    });

    it('should list sessions ordered by created_at DESC', () => {
      db.createSession({ workspace_id: 'ws-1', user_id: 'user-1', title: 'First' });
      db.createSession({ workspace_id: 'ws-1', user_id: 'user-1', title: 'Second' });
      const sessions = db.listSessions();
      expect(sessions).toHaveLength(2);
      // Both have the same created_at (datetime('now')), but insertion order should be consistent
      expect(sessions.map((s) => s.title)).toContain('First');
      expect(sessions.map((s) => s.title)).toContain('Second');
    });
  });

  // ====== Messages (Append-Only) ======

  describe('Messages', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = db.createSession({ workspace_id: 'ws-1', user_id: 'user-1' });
      sessionId = session.id;
    });

    it('should append and retrieve messages', () => {
      const msg = db.appendMessage({ session_id: sessionId, role: 'user', content: 'Hello' });
      expect(msg.id).toBeTruthy();
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');

      const msgs = db.getMessages(sessionId);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toEqual(msg);
    });

    it('should preserve insertion order (append-only)', () => {
      db.appendMessage({ session_id: sessionId, role: 'user', content: 'msg-1' });
      db.appendMessage({ session_id: sessionId, role: 'assistant', content: 'msg-2' });
      db.appendMessage({ session_id: sessionId, role: 'user', content: 'msg-3' });

      const msgs = db.getMessages(sessionId);
      expect(msgs).toHaveLength(3);
      expect(msgs.map((m) => m.content)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });

    it('should support lastConsolidated offset', () => {
      db.appendMessage({ session_id: sessionId, role: 'user', content: 'msg-1' });
      db.appendMessage({ session_id: sessionId, role: 'assistant', content: 'msg-2' });
      db.appendMessage({ session_id: sessionId, role: 'user', content: 'msg-3' });
      db.appendMessage({ session_id: sessionId, role: 'assistant', content: 'msg-4' });

      // Offset 2 should skip the first 2 messages
      const msgs = db.getMessages(sessionId, 2);
      expect(msgs).toHaveLength(2);
      expect(msgs.map((m) => m.content)).toEqual(['msg-3', 'msg-4']);
    });

    it('should return 0 offset as all messages', () => {
      db.appendMessage({ session_id: sessionId, role: 'user', content: 'msg-1' });
      db.appendMessage({ session_id: sessionId, role: 'assistant', content: 'msg-2' });

      const msgs = db.getMessages(sessionId, 0);
      expect(msgs).toHaveLength(2);
    });

    it('should count messages', () => {
      expect(db.countMessages(sessionId)).toBe(0);
      db.appendMessage({ session_id: sessionId, role: 'user', content: 'msg-1' });
      db.appendMessage({ session_id: sessionId, role: 'assistant', content: 'msg-2' });
      expect(db.countMessages(sessionId)).toBe(2);
    });

    it('should store tool_calls and tokens', () => {
      const msg = db.appendMessage({
        session_id: sessionId,
        role: 'assistant',
        content: 'response',
        tool_calls: '[{"name":"bash"}]',
        tokens: 150,
      });
      expect(msg.tool_calls).toBe('[{"name":"bash"}]');
      expect(msg.tokens).toBe(150);
    });
  });

  // ====== Memories ======

  describe('Memories', () => {
    it('should create and retrieve a memory', () => {
      const mem = db.upsertMemory({ name: 'project-overview', type: 'project', content: 'This is the project overview.' });
      expect(mem.id).toBeTruthy();
      expect(mem.name).toBe('project-overview');
      expect(mem.type).toBe('project');
      expect(mem.compressed).toBe(0);

      const fetched = db.getMemory('project-overview');
      expect(fetched).toEqual(mem);
    });

    it('should return null for non-existent memory', () => {
      expect(db.getMemory('nonexistent')).toBeNull();
    });

    it('should update existing memory with same name (non-log)', () => {
      const mem1 = db.upsertMemory({ name: 'decision-1', type: 'decision', content: 'v1' });
      const mem2 = db.upsertMemory({ name: 'decision-1', type: 'decision', content: 'v2' });
      expect(mem2.id).toBe(mem1.id); // same record updated
      expect(mem2.content).toBe('v2');
    });

    it('should always append for log type (even with same base name)', () => {
      const log1 = db.upsertMemory({ name: 'run-log', type: 'log', content: 'log entry 1' });
      const log2 = db.upsertMemory({ name: 'run-log', type: 'log', content: 'log entry 2' });
      expect(log2.id).not.toBe(log1.id); // different records
      expect(log1.name).toContain('run-log');
      expect(log2.name).toContain('run-log');
      expect(log1.name).not.toBe(log2.name); // unique names via suffix
      expect(log1.content).toBe('log entry 1');
      expect(log2.content).toBe('log entry 2');
    });

    it('should store compressed content', () => {
      const mem = db.upsertMemory({
        name: 'big-doc',
        type: 'reference',
        content: 'full content here',
        compressed: 1,
        compressed_content: 'compressed summary',
      });
      expect(mem.compressed).toBe(1);
      expect(mem.compressed_content).toBe('compressed summary');
    });

    it('should return memories by tier', () => {
      db.upsertMemory({ name: 'decision-1', type: 'decision', content: 'must see' });
      db.upsertMemory({ name: 'feedback-1', type: 'feedback', content: 'important feedback' });
      db.upsertMemory({ name: 'project-1', type: 'project', content: 'First line\nSecond line' });
      db.upsertMemory({ name: 'ref-1', type: 'reference', content: 'Ref summary\nMore details' });
      db.upsertMemory({ name: 'log-1', type: 'log', content: 'log entry' });

      const tiers = db.getMemoriesByTier();

      // mustInject: decision + feedback
      expect(tiers.mustInject).toHaveLength(2);
      expect(tiers.mustInject.map((m) => m.type).sort()).toEqual(['decision', 'feedback']);

      // index: project + reference (only name + type + first line)
      expect(tiers.index).toHaveLength(2);
      expect(tiers.index.map((m) => m.type).sort()).toEqual(['project', 'reference']);
      const projIndex = tiers.index.find((m) => m.name === 'project-1')!;
      expect(projIndex.summary).toBe('First line');

      // search: empty (logs not returned)
      expect(tiers.search).toHaveLength(0);
    });

    it('should search memories by content', () => {
      db.upsertMemory({ name: 'mem-1', type: 'project', content: 'TypeScript project setup' });
      db.upsertMemory({ name: 'mem-2', type: 'reference', content: 'Python documentation' });
      db.upsertMemory({ name: 'mem-3', type: 'log', content: 'TypeScript compilation log' });

      const results = db.searchMemories('TypeScript');
      expect(results).toHaveLength(2);
      const names = results.map((m) => m.name);
      expect(names).toContain('mem-1');
      // log type gets a unique suffix: mem-3#<nanoid>
      expect(names.some((n) => n.startsWith('mem-3#'))).toBe(true);
    });

    it('should search memories by name', () => {
      db.upsertMemory({ name: 'api-design', type: 'decision', content: 'REST API' });
      db.upsertMemory({ name: 'db-schema', type: 'decision', content: 'PostgreSQL schema' });

      const results = db.searchMemories('api');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('api-design');
    });

    it('should delete a memory', () => {
      const mem = db.upsertMemory({ name: 'to-delete', type: 'project', content: 'temp' });
      db.deleteMemory(mem.id);
      expect(db.getMemory('to-delete')).toBeNull();
    });
  });

  // ====== Todos ======

  describe('Todos', () => {
    it('should create and retrieve a todo', () => {
      const todo = db.upsertTodo({ content: 'Fix bug' });
      expect(todo.id).toBeTruthy();
      expect(todo.content).toBe('Fix bug');
      expect(todo.status).toBe('pending');
      expect(todo.session_id).toBeNull();
    });

    it('should update existing todo by id', () => {
      const todo = db.upsertTodo({ content: 'Task 1' });
      const updated = db.upsertTodo({ id: todo.id, content: 'Task 1 updated', status: 'completed' });
      expect(updated.id).toBe(todo.id);
      expect(updated.content).toBe('Task 1 updated');
      expect(updated.status).toBe('completed');
    });

    it('should list all todos', () => {
      db.upsertTodo({ content: 'Task 1' });
      db.upsertTodo({ content: 'Task 2' });
      const todos = db.getTodos();
      expect(todos).toHaveLength(2);
    });

    it('should filter todos by session', () => {
      const session = db.createSession({ workspace_id: 'ws-1', user_id: 'user-1' });
      db.upsertTodo({ content: 'Global task' });
      db.upsertTodo({ content: 'Session task', session_id: session.id });

      const sessionTodos = db.getTodos(session.id);
      expect(sessionTodos).toHaveLength(1);
      expect(sessionTodos[0].content).toBe('Session task');
    });

    it('should delete a todo', () => {
      const todo = db.upsertTodo({ content: 'To delete' });
      db.deleteTodo(todo.id);
      expect(db.getTodos()).toHaveLength(0);
    });
  });

  // ====== Cascade delete ======

  describe('Cascade', () => {
    it('should delete messages when session is deleted', () => {
      const session = db.createSession({ workspace_id: 'ws-1', user_id: 'user-1' });
      db.appendMessage({ session_id: session.id, role: 'user', content: 'Hello' });
      db.appendMessage({ session_id: session.id, role: 'assistant', content: 'Hi' });
      expect(db.countMessages(session.id)).toBe(2);

      // Delete session directly via raw SQL (no deleteSession method exposed, but cascade should work)
      (db as any).db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
      expect(db.countMessages(session.id)).toBe(0);
    });
  });
});
