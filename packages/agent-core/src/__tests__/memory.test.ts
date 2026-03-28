import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '../memory/in-memory-store.js';
import { SQLiteMemoryStore } from '../memory/sqlite-store.js';
import type { MemoryStore } from '../memory/types.js';
import { existsSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ====== 通用测试套件，InMemoryStore 和 SQLiteMemoryStore 共享 ======

function defineMemoryStoreTests(
  name: string,
  factory: () => MemoryStore,
  cleanup?: () => void,
) {
  describe(name, () => {
    let store: MemoryStore;

    beforeEach(() => {
      store = factory();
    });

    afterEach(() => {
      cleanup?.();
    });

    // 基础键值操作
    describe('基础键值操作', () => {
      it('get 返回 undefined（键不存在时）', () => {
        expect(store.get('missing')).toBeUndefined();
      });

      it('set/get 读写正常', () => {
        store.set('k1', 'v1');
        expect(store.get('k1')).toBe('v1');
      });

      it('set 覆盖已有值', () => {
        store.set('k1', 'v1');
        store.set('k1', 'v2');
        expect(store.get('k1')).toBe('v2');
      });

      it('delete 删除键', () => {
        store.set('k1', 'v1');
        store.delete('k1');
        expect(store.get('k1')).toBeUndefined();
      });

      it('keys 返回所有键', () => {
        store.set('a', '1');
        store.set('b', '2');
        expect(store.keys().sort()).toEqual(['a', 'b']);
      });
    });

    // 分层记忆操作
    describe('分层记忆操作', () => {
      it('upsertMemory 存储后可通过 getMemories 获取', () => {
        store.upsertMemory('项目概览', 'project', '这是一个 CLI 工具');
        const memories = store.getMemories();
        expect(memories).toHaveLength(1);
        expect(memories[0].name).toBe('项目概览');
        expect(memories[0].type).toBe('project');
        expect(memories[0].content).toBe('这是一个 CLI 工具');
        expect(memories[0].updatedAt).toBeInstanceOf(Date);
      });

      it('upsertMemory 更新已有条目', () => {
        store.upsertMemory('项目概览', 'project', '旧内容');
        store.upsertMemory('项目概览', 'project', '新内容');
        const memories = store.getMemories();
        expect(memories).toHaveLength(1);
        expect(memories[0].content).toBe('新内容');
      });

      it('getMemories 按类型过滤', () => {
        store.upsertMemory('决策1', 'decision', '用 Redis');
        store.upsertMemory('反馈1', 'feedback', '响应太慢');
        store.upsertMemory('项目1', 'project', '概览');

        const decisions = store.getMemories('decision');
        expect(decisions).toHaveLength(1);
        expect(decisions[0].type).toBe('decision');

        const all = store.getMemories();
        expect(all).toHaveLength(3);
      });

      it('getMemories 返回按 updatedAt 降序排列', async () => {
        store.upsertMemory('first', 'project', '第一条');
        // 加一点延迟确保时间戳不同
        await new Promise((r) => setTimeout(r, 10));
        store.upsertMemory('second', 'project', '第二条');

        const memories = store.getMemories();
        expect(memories[0].name).toBe('second');
        expect(memories[1].name).toBe('first');
      });

      it('searchMemories 按 name 关键词搜索', () => {
        store.upsertMemory('Redis 决策', 'decision', '选择 Redis');
        store.upsertMemory('项目概览', 'project', '工具描述');

        const results = store.searchMemories('Redis');
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Redis 决策');
      });

      it('searchMemories 按 content 关键词搜索', () => {
        store.upsertMemory('决策1', 'decision', '选择 PostgreSQL 作为主数据库');
        store.upsertMemory('决策2', 'decision', '选择 Redis 作为缓存');

        const results = store.searchMemories('PostgreSQL');
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('决策1');
      });

      it('searchMemories 支持 limit 参数', () => {
        for (let i = 0; i < 5; i++) {
          store.upsertMemory(`memo-${i}`, 'log', `内容 ${i}`);
        }
        const results = store.searchMemories('内容', 2);
        expect(results).toHaveLength(2);
      });

      it('searchMemories 不区分大小写', () => {
        store.upsertMemory('Test Entry', 'project', 'Hello World');
        const results = store.searchMemories('hello');
        expect(results).toHaveLength(1);
      });
    });
  });
}

// ====== InMemoryStore 测试 ======

defineMemoryStoreTests('InMemoryStore', () => new InMemoryStore());

// ====== SQLiteMemoryStore 测试 ======

let sqliteAvailable = false;
try {
  require('better-sqlite3');
  sqliteAvailable = true;
} catch {
  // better-sqlite3 不可用，跳过 SQLite 测试
}

if (sqliteAvailable) {
  let tmpDir: string;
  let dbPath: string;
  let currentStore: SQLiteMemoryStore | null = null;

  defineMemoryStoreTests(
    'SQLiteMemoryStore',
    () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'agent-core-test-'));
      dbPath = join(tmpDir, 'test.db');
      currentStore = new SQLiteMemoryStore(dbPath);
      return currentStore;
    },
    () => {
      currentStore?.close();
      currentStore = null;
      // 清理数据库文件（WAL 模式会生成额外文件）
      for (const suffix of ['', '-wal', '-shm']) {
        const file = dbPath + suffix;
        if (existsSync(file)) {
          unlinkSync(file);
        }
      }
    },
  );

  // SQLite 特有测试：数据持久化
  describe('SQLiteMemoryStore 持久化', () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'agent-core-test-'));
      dbPath = join(tmpDir, 'persist.db');
    });

    afterEach(() => {
      for (const suffix of ['', '-wal', '-shm']) {
        const file = dbPath + suffix;
        if (existsSync(file)) {
          unlinkSync(file);
        }
      }
    });

    it('关闭后重新打开，数据仍在', () => {
      const store1 = new SQLiteMemoryStore(dbPath);
      store1.set('key', 'value');
      store1.upsertMemory('持久化测试', 'decision', '重要决策');
      store1.close();

      const store2 = new SQLiteMemoryStore(dbPath);
      expect(store2.get('key')).toBe('value');
      const memories = store2.getMemories('decision');
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toBe('重要决策');
      store2.close();
    });
  });
} else {
  describe.skip('SQLiteMemoryStore（better-sqlite3 未安装，跳过）', () => {
    it('placeholder', () => {});
  });
}
