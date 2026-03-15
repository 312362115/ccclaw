import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, integer, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';
import { SYSTEM_ROLES, SESSION_STATUSES, MEMORY_TYPES, TASK_RUN_STATUSES } from './schema.types.js';

export const systemRoleEnum = pgEnum('system_role', SYSTEM_ROLES);
export const sessionStatusEnum = pgEnum('session_status', SESSION_STATUSES);
export const memoryTypeEnum = pgEnum('memory_type', MEMORY_TYPES);
export const taskRunStatusEnum = pgEnum('task_run_status', TASK_RUN_STATUSES);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  role: systemRoleEnum('role').notNull().default('user'),
  gitToken: text('git_token'), // AES-256-GCM encrypted，用户级 git 凭证
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  language: varchar('language', { length: 20 }),
  style: varchar('style', { length: 50 }),
  customRules: text('custom_rules'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  gitRepo: varchar('git_repo', { length: 500 }),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 50 }).notNull().default('claude'),
  authType: varchar('auth_type', { length: 20 }).notNull().default('api_key'),
  config: jsonb('config').notNull(), // AES-256-GCM 加密
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// sessions、messages、memories 不在主数据库
// 存放在工作区 workspace.db（SQLite + WAL）中，Runner 本地读写
// Server 通过 RunnerManager 代理查询

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  content: text('content').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('skills_unique').on(t.userId, t.workspaceId, t.name)]);

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  command: varchar('command', { length: 500 }).notNull(),
  args: jsonb('args').notNull().default([]),
  env: jsonb('env'),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('mcp_servers_unique').on(t.userId, t.workspaceId, t.name)]);

export const scheduledTasks = pgTable('scheduled_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  cron: varchar('cron', { length: 100 }).notNull(),
  prompt: text('prompt').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
});

export const taskRuns = pgTable('task_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => scheduledTasks.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(), // workspace.db 中的 session，不做 FK
  status: taskRunStatusEnum('status').notNull().default('running'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  error: text('error'),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  target: varchar('target', { length: 255 }).notNull(),
  detail: jsonb('detail'),
  ip: varchar('ip', { length: 45 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const inviteCodes = pgTable('invite_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  usedBy: uuid('used_by').references(() => users.id),
  usedAt: timestamp('used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tokenUsage = pgTable('token_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  sessionId: uuid('session_id').notNull(), // workspace.db 中的 session，不做 FK
  providerId: uuid('provider_id').notNull().references(() => providers.id),
  model: varchar('model', { length: 100 }).notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 500 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
