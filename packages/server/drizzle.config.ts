import { defineConfig } from 'drizzle-kit';
import path from 'node:path';

const dialect = (process.env.DB_DIALECT || 'sqlite') as 'postgresql' | 'mysql' | 'sqlite';

const configs = {
  sqlite: {
    schema: './src/db/schema.sqlite.ts',
    out: './src/db/migrations-sqlite',
    dialect: 'sqlite' as const,
    dbCredentials: {
      url: path.join(process.env.DATA_DIR || '/data/ccclaw', 'ccclaw.db'),
    },
  },
  mysql: {
    schema: './src/db/schema.mysql.ts',
    out: './src/db/migrations-mysql',
    dialect: 'mysql' as const,
    dbCredentials: {
      url: process.env.DATABASE_URL!,
    },
  },
  postgresql: {
    schema: './src/db/schema.pg.ts',
    out: './src/db/migrations-pg',
    dialect: 'postgresql' as const,
    dbCredentials: {
      url: process.env.DATABASE_URL!,
    },
  },
};

export default defineConfig(configs[dialect]);
