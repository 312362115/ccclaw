import { mysqlTable, varchar, text, boolean, timestamp, json, int, uniqueIndex, mysqlEnum } from 'drizzle-orm/mysql-core';
import { SYSTEM_ROLES, SESSION_STATUSES, MEMORY_TYPES, TASK_RUN_STATUSES } from './schema.types.js';
import { nanoid } from '@ccclaw/shared';

// MySQL: 使用 VARCHAR(21) 存 nanoid，native ENUM，JSON 类型

const id = () => varchar('id', { length: 21 }).primaryKey().$defaultFn(() => nanoid());
const createdAt = () => timestamp('created_at').notNull().defaultNow();

export const users = mysqlTable('users', {
  id: id(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  role: mysqlEnum('role', SYSTEM_ROLES).notNull().default('user'),
  gitToken: text('git_token'),
  createdAt: createdAt(),
});

export const userPreferences = mysqlTable('user_preferences', {
  id: id(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  language: varchar('language', { length: 20 }),
  style: varchar('style', { length: 50 }),
  customRules: text('custom_rules'),
  agentModel: varchar('agent_model', { length: 100 }),
  maxTokens: int('max_tokens'),
  contextWindowTokens: int('context_window_tokens'),
  temperature: int('temperature'),
  reasoningEffort: varchar('reasoning_effort', { length: 20 }),
  toolConfirmMode: varchar('tool_confirm_mode', { length: 20 }),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

export const workspaces = mysqlTable('workspaces', {
  id: id(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  createdBy: varchar('created_by', { length: 21 }).notNull().references(() => users.id),
  gitRepo: varchar('git_repo', { length: 500 }),
  settings: json('settings').notNull().default({}),
  createdAt: createdAt(),
});

export const providers = mysqlTable('providers', {
  id: id(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 50 }).notNull().default('claude'),
  authType: varchar('auth_type', { length: 20 }).notNull().default('api_key'),
  config: json('config').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  oauthState: text('oauth_state'),  // JSON encrypted: { accessToken, refreshToken, expiresAt, scope }
  createdAt: createdAt(),
});

// sessions、messages、memories 不在主数据库
// 存放在工作区 workspace.db（SQLite + WAL）中，Runner 本地读写

export const skills = mysqlTable('skills', {
  id: id(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: varchar('workspace_id', { length: 21 }).references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  content: text('content').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
}, (t) => [uniqueIndex('skills_unique').on(t.userId, t.workspaceId, t.name)]);

export const mcpServers = mysqlTable('mcp_servers', {
  id: id(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: varchar('workspace_id', { length: 21 }).references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  command: varchar('command', { length: 500 }).notNull(),
  args: json('args').notNull().default([]),
  env: json('env'),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
}, (t) => [uniqueIndex('mcp_servers_unique').on(t.userId, t.workspaceId, t.name)]);

export const scheduledTasks = mysqlTable('scheduled_tasks', {
  id: id(),
  workspaceId: varchar('workspace_id', { length: 21 }).notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  cron: varchar('cron', { length: 100 }).notNull(),
  prompt: text('prompt').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
});

export const taskRuns = mysqlTable('task_runs', {
  id: id(),
  taskId: varchar('task_id', { length: 21 }).notNull().references(() => scheduledTasks.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 21 }).notNull(), // workspace.db 中的 session，不做 FK
  status: mysqlEnum('status', TASK_RUN_STATUSES).notNull().default('running'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  error: text('error'),
});

export const auditLogs = mysqlTable('audit_logs', {
  id: id(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  target: varchar('target', { length: 255 }).notNull(),
  detail: json('detail'),
  ip: varchar('ip', { length: 45 }).notNull(),
  createdAt: createdAt(),
});

export const adminLogs = mysqlTable('admin_logs', {
  id: id(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  target: varchar('target', { length: 255 }).notNull(),
  detail: json('detail'),
  ip: varchar('ip', { length: 45 }).notNull(),
  createdAt: createdAt(),
});

export const inviteCodes = mysqlTable('invite_codes', {
  id: id(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  createdBy: varchar('created_by', { length: 21 }).notNull().references(() => users.id),
  usedBy: varchar('used_by', { length: 21 }).references(() => users.id),
  usedAt: timestamp('used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: createdAt(),
});

export const tokenUsage = mysqlTable('token_usage', {
  id: id(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id),
  workspaceId: varchar('workspace_id', { length: 21 }).notNull().references(() => workspaces.id),
  sessionId: varchar('session_id', { length: 21 }).notNull(), // workspace.db 中的 session，不做 FK
  providerId: varchar('provider_id', { length: 21 }).notNull().references(() => providers.id),
  model: varchar('model', { length: 100 }).notNull(),
  inputTokens: int('input_tokens').notNull(),
  outputTokens: int('output_tokens').notNull(),
  createdAt: createdAt(),
});

export const refreshTokens = mysqlTable('refresh_tokens', {
  id: id(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 500 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: createdAt(),
});

export const oauthStates = mysqlTable('oauth_states', {
  state: varchar('state', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(),
  codeVerifier: text('code_verifier').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
