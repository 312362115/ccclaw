import Database from 'better-sqlite3';
import { nanoid } from '@ccclaw/shared';

// ====== Types ======

export interface Session {
  id: string;
  workspace_id: string;
  user_id: string;
  channel_type: string;
  title: string;
  status: string;
  summary: string | null;
  last_consolidated: number;
  created_at: string;
}

export interface NewSession {
  workspace_id: string;
  user_id: string;
  channel_type?: string;
  title?: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tokens: number | null;
  created_at: string;
}

export interface NewMessage {
  session_id: string;
  role: string;
  content: string;
  tool_calls?: string | null;
  tokens?: number | null;
}

export interface Memory {
  id: string;
  name: string;
  type: 'project' | 'reference' | 'decision' | 'feedback' | 'log';
  content: string;
  compressed: number;
  compressed_content: string | null;
  embedding: Buffer | null;
  updated_at: string;
}

export interface NewMemory {
  name: string;
  type: 'project' | 'reference' | 'decision' | 'feedback' | 'log';
  content: string;
  compressed?: number;
  compressed_content?: string | null;
}

export interface Todo {
  id: string;
  session_id: string | null;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface NewTodo {
  id?: string;
  session_id?: string | null;
  content: string;
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface MemoryTiers {
  mustInject: Memory[];
  index: Array<{ id: string; name: string; type: string; summary: string }>;
  search: never[];
}

// ====== WorkspaceDB ======

export class WorkspaceDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        channel_type TEXT NOT NULL DEFAULT 'webui',
        title TEXT NOT NULL DEFAULT '新会话',
        status TEXT NOT NULL DEFAULT 'active',
        summary TEXT,
        last_consolidated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tokens INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK(type IN ('project','reference','decision','feedback','log')),
        content TEXT NOT NULL,
        compressed INTEGER NOT NULL DEFAULT 0,
        compressed_content TEXT,
        embedding BLOB,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // ====== Sessions CRUD ======

  createSession(session: NewSession): Session {
    const id = nanoid();
    return this.createSessionWithId(id, session);
  }

  createSessionWithId(id: string, session: NewSession): Session {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, workspace_id, user_id, channel_type, title)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      session.workspace_id,
      session.user_id,
      session.channel_type ?? 'webui',
      session.title ?? '新会话',
    );
    return this.getSession(id)!;
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return (stmt.get(id) as Session | undefined) ?? null;
  }

  updateSession(id: string, updates: Partial<Pick<Session, 'title' | 'status' | 'summary' | 'last_consolidated'>>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
    if (updates.last_consolidated !== undefined) { fields.push('last_consolidated = ?'); values.push(updates.last_consolidated); }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  listSessions(): Session[] {
    return this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as Session[];
  }

  // ====== Messages (Append-Only) ======

  appendMessage(msg: NewMessage): Message {
    const id = nanoid();
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, tool_calls, tokens)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, msg.session_id, msg.role, msg.content, msg.tool_calls ?? null, msg.tokens ?? null);
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message;
  }

  getMessages(sessionId: string, offset?: number): Message[] {
    if (offset !== undefined && offset > 0) {
      return this.db.prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT -1 OFFSET ?',
      ).all(sessionId, offset) as Message[];
    }
    return this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    ).all(sessionId) as Message[];
  }

  countMessages(sessionId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?').get(sessionId) as { cnt: number };
    return row.cnt;
  }

  // ====== Memories ======

  upsertMemory(memory: NewMemory): Memory {
    // log type always appends (never updates existing) — generate unique name with suffix
    if (memory.type === 'log') {
      const id = nanoid();
      const uniqueName = `${memory.name}#${id}`;
      this.db.prepare(`
        INSERT INTO memories (id, name, type, content, compressed, compressed_content)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, uniqueName, memory.type, memory.content, memory.compressed ?? 0, memory.compressed_content ?? null);
      return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory;
    }

    // For non-log types, update if same name exists
    const existing = this.db.prepare('SELECT id FROM memories WHERE name = ?').get(memory.name) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(`
        UPDATE memories SET content = ?, compressed = ?, compressed_content = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(memory.content, memory.compressed ?? 0, memory.compressed_content ?? null, existing.id);
      return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(existing.id) as Memory;
    }

    const id = nanoid();
    this.db.prepare(`
      INSERT INTO memories (id, name, type, content, compressed, compressed_content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, memory.name, memory.type, memory.content, memory.compressed ?? 0, memory.compressed_content ?? null);
    return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory;
  }

  getMemory(name: string): Memory | null {
    return (this.db.prepare('SELECT * FROM memories WHERE name = ?').get(name) as Memory | undefined) ?? null;
  }

  getMemoriesByTier(): MemoryTiers {
    // decision + feedback -> mustInject (full content, prefer compressed_content)
    const mustInject = this.db.prepare(
      "SELECT * FROM memories WHERE type IN ('decision', 'feedback') ORDER BY updated_at DESC",
    ).all() as Memory[];

    // project + reference -> index (name + type + first line summary)
    const indexRows = this.db.prepare(
      "SELECT id, name, type, content FROM memories WHERE type IN ('project', 'reference') ORDER BY updated_at DESC",
    ).all() as Array<{ id: string; name: string; type: string; content: string }>;

    const index = indexRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      summary: row.content.split('\n')[0] ?? '',
    }));

    // log -> search (not returned, use searchMemories)
    return { mustInject, index, search: [] };
  }

  searchMemories(query: string, limit = 20): Memory[] {
    // Simple LIKE-based search; can be upgraded to FTS5 later
    const pattern = `%${query}%`;
    return this.db.prepare(
      'SELECT * FROM memories WHERE content LIKE ? OR name LIKE ? ORDER BY updated_at DESC LIMIT ?',
    ).all(pattern, pattern, limit) as Memory[];
  }

  getMemoriesByType(type: Memory['type']): Memory[] {
    return this.db.prepare(
      'SELECT * FROM memories WHERE type = ? ORDER BY updated_at ASC',
    ).all(type) as Memory[];
  }

  deleteMemory(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  // ====== Todos ======

  upsertTodo(todo: NewTodo): Todo {
    if (todo.id) {
      const existing = this.db.prepare('SELECT id FROM todos WHERE id = ?').get(todo.id) as { id: string } | undefined;
      if (existing) {
        this.db.prepare(`
          UPDATE todos SET content = ?, status = ?, session_id = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(todo.content, todo.status ?? 'pending', todo.session_id ?? null, todo.id);
        return this.db.prepare('SELECT * FROM todos WHERE id = ?').get(todo.id) as Todo;
      }
    }

    const id = todo.id ?? nanoid();
    this.db.prepare(`
      INSERT INTO todos (id, session_id, content, status)
      VALUES (?, ?, ?, ?)
    `).run(id, todo.session_id ?? null, todo.content, todo.status ?? 'pending');
    return this.db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo;
  }

  getTodos(sessionId?: string): Todo[] {
    if (sessionId) {
      return this.db.prepare('SELECT * FROM todos WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Todo[];
    }
    return this.db.prepare('SELECT * FROM todos ORDER BY created_at ASC').all() as Todo[];
  }

  deleteTodo(id: string): void {
    this.db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  }

  // ====== Lifecycle ======

  close(): void {
    this.db.close();
  }
}
