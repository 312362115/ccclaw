import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';

// 从项目根目录加载 .env
dotenvConfig({ path: resolve(import.meta.dirname, '../../../.env') });

const envSchema = z.object({
  DB_DIALECT: z.enum(['sqlite', 'postgresql', 'mysql']).default('sqlite'),
  DATABASE_URL: z.string().optional(), // PostgreSQL / MySQL 模式必填
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  RUNNER_SECRET: z.string().min(16).default(() => randomBytes(32).toString('hex')),
  DATA_DIR: z.string().default('/data/ccclaw'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SCHEDULER_CONCURRENCY: z.coerce.number().default(3),
  MAX_TASKS_PER_USER: z.coerce.number().default(10),
}).refine(
  (env) => env.DB_DIALECT === 'sqlite' || !!env.DATABASE_URL,
  { message: 'DATABASE_URL is required when DB_DIALECT is postgresql or mysql', path: ['DATABASE_URL'] },
);

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
