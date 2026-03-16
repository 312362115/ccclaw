import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { nanoid } from '@ccclaw/shared';

// SQLite 没有 enum / uuid / jsonb，全部用 text 替代
// id 默认值通过应用层 nanoid() 生成

const id = () => text('id').primaryKey().$defaultFn(() => nanoid());
const createdAt = () => text('created_at').notNull().$defaultFn(() => new Date().toISOString());

export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull().default('user'), // 'admin' | 'user'
  gitToken: text('git_token'),
  createdAt: createdAt(),
});

export const userPreferences = sqliteTable('user_preferences', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  language: text('language'),
  style: text('style'),
  customRules: text('custom_rules'),
  agentModel: text('agent_model'),
  maxTokens: integer('max_tokens'),
  contextWindowTokens: integer('context_window_tokens'),
  temperature: integer('temperature'), // stored as integer * 100 (e.g. 70 = 0.7)
  reasoningEffort: text('reasoning_effort'), // 'low' | 'medium' | 'high'
  toolConfirmMode: text('tool_confirm_mode'), // 'always' | 'smart' | 'never'
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdBy: text('created_by').notNull().references(() => users.id),
  gitRepo: text('git_repo'),
  settings: text('settings', { mode: 'json' }).notNull().default('{}'),
  createdAt: createdAt(),
});

export const providers = sqliteTable('providers', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('claude'),
  authType: text('auth_type').notNull().default('api_key'),
  config: text('config', { mode: 'json' }).notNull(), // AES-256-GCM 加密
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

// sessions、messages、memories 不在主数据库
// 存放在工作区 workspace.db 中，Runner 本地读写

export const skills = sqliteTable('skills', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  content: text('content').notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [uniqueIndex('skills_unique').on(t.userId, t.workspaceId, t.name)]);

export const mcpServers = sqliteTable('mcp_servers', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  command: text('command').notNull(),
  args: text('args', { mode: 'json' }).notNull().$type<string[]>().default([]),
  env: text('env', { mode: 'json' }).$type<Record<string, string>>(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [uniqueIndex('mcp_servers_unique').on(t.userId, t.workspaceId, t.name)]);

export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  cron: text('cron').notNull(),
  prompt: text('prompt').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
});

export const taskRuns = sqliteTable('task_runs', {
  id: id(),
  taskId: text('task_id').notNull().references(() => scheduledTasks.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(), // workspace.db 中的 session，不做 FK
  status: text('status').notNull().default('running'), // 'running' | 'success' | 'failed'
  startedAt: text('started_at').notNull().$defaultFn(() => new Date().toISOString()),
  finishedAt: text('finished_at'),
  error: text('error'),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  target: text('target').notNull(),
  detail: text('detail', { mode: 'json' }),
  ip: text('ip').notNull(),
  createdAt: createdAt(),
});

export const adminLogs = sqliteTable('admin_logs', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  target: text('target').notNull(),
  detail: text('detail', { mode: 'json' }),
  ip: text('ip').notNull(),
  createdAt: createdAt(),
});

export const inviteCodes = sqliteTable('invite_codes', {
  id: id(),
  code: text('code').notNull().unique(),
  createdBy: text('created_by').notNull().references(() => users.id),
  usedBy: text('used_by').references(() => users.id),
  usedAt: text('used_at'),
  expiresAt: text('expires_at'),
  createdAt: createdAt(),
});

export const tokenUsage = sqliteTable('token_usage', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  sessionId: text('session_id').notNull(), // workspace.db 中的 session，不做 FK
  providerId: text('provider_id').notNull().references(() => providers.id),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  createdAt: createdAt(),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt(),
});
