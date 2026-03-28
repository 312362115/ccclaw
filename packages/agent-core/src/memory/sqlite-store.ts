/**
 * SQLiteMemoryStore — 基于 SQLite 的持久化 MemoryStore 实现
 *
 * 使用 better-sqlite3 作为可选依赖。未安装时构造函数会抛出清晰的错误提示。
 * 适用于需要跨会话持久化记忆的场景。
 */

import type { MemoryStore, MemoryType, MemoryEntry } from './types.js';

// better-sqlite3 的最小类型定义，避免强依赖 @types/better-sqlite3
interface Statement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  pragma(pragma: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

type SqliteConstructor = new (filename: string) => SqliteDatabase;

export class SQLiteMemoryStore implements MemoryStore {
  private db: SqliteDatabase;

  constructor(dbPath: string) {
    // 动态加载 better-sqlite3，未安装时给出清晰提示
    let Database: SqliteConstructor;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Database = require('better-sqlite3') as SqliteConstructor;
    } catch {
      throw new Error(
        "SQLiteMemoryStore requires 'better-sqlite3'. Install with: pnpm add better-sqlite3",
      );
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('decision','feedback','project','reference','log')),
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  // ====== 基础键值操作 ======

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, value);
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  }

  keys(): string[] {
    const rows = this.db.prepare('SELECT key FROM kv').all() as Array<{ key: string }>;
    return rows.map((r) => r.key);
  }

  // ====== 分层记忆操作 ======

  upsertMemory(name: string, type: MemoryType, content: string): void {
    // 使用 JS 端的 ISO 时间戳，精度到毫秒（SQLite datetime('now') 只有秒级精度）
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memories (name, type, content, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(name, type, content, now);
  }

  getMemories(type?: MemoryType): MemoryEntry[] {
    let rows: Array<{ name: string; type: string; content: string; updated_at: string }>;
    if (type) {
      rows = this.db
        .prepare('SELECT * FROM memories WHERE type = ? ORDER BY updated_at DESC')
        .all(type) as typeof rows;
    } else {
      rows = this.db
        .prepare('SELECT * FROM memories ORDER BY updated_at DESC')
        .all() as typeof rows;
    }
    return rows.map((r) => ({
      name: r.name,
      type: r.type as MemoryType,
      content: r.content,
      updatedAt: new Date(r.updated_at),
    }));
  }

  searchMemories(query: string, limit = 20): MemoryEntry[] {
    const pattern = `%${query}%`;
    const rows = this.db
      .prepare(
        'SELECT * FROM memories WHERE name LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT ?',
      )
      .all(pattern, pattern, limit) as Array<{
      name: string;
      type: string;
      content: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      name: r.name,
      type: r.type as MemoryType,
      content: r.content,
      updatedAt: new Date(r.updated_at),
    }));
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }
}
