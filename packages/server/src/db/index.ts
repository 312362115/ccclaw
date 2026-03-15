import { config } from '../config.js';
import { logger } from '../logger.js';

// 多方言动态连接——运行时只会走一个分支，但 TypeScript 无法推断联合类型的 db 方法兼容性
// 因此用 DbInstance 做类型擦除，业务层通过 schema 字段访问具体表
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

interface DbConnection {
  db: DbInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  dialect: 'sqlite' | 'mysql' | 'postgresql';
}

async function createDb(): Promise<DbConnection> {
  if (config.DB_DIALECT === 'sqlite') {
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const Database = (await import('better-sqlite3')).default;
    const schema = await import('./schema.sqlite.js');
    const path = await import('node:path');
    const fs = await import('node:fs');

    const dbPath = path.join(config.DATA_DIR, 'ccclaw.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    logger.info({ dialect: 'sqlite', path: dbPath }, '数据库已连接');
    return { db: drizzle(sqlite, { schema }), schema, dialect: 'sqlite' };
  } else if (config.DB_DIALECT === 'mysql') {
    const { drizzle } = await import('drizzle-orm/mysql2');
    const mysql = await import('mysql2/promise');
    const schema = await import('./schema.mysql.js');

    const pool = mysql.createPool(config.DATABASE_URL!);
    logger.info({ dialect: 'mysql' }, '数据库已连接');
    return { db: drizzle(pool, { schema, mode: 'default' }), schema, dialect: 'mysql' };
  } else {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const schema = await import('./schema.pg.js');

    const client = postgres(config.DATABASE_URL!);
    logger.info({ dialect: 'postgresql' }, '数据库已连接');
    return { db: drizzle(client, { schema }), schema, dialect: 'postgresql' };
  }
}

export const { db, schema, dialect } = await createDb();
