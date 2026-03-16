import { z } from 'zod';

// Auth
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// User
export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'user']).default('user'),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
});

// Workspace
export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  gitRepo: z.string().url().optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  gitRepo: z.string().url().optional(),
  settings: z.record(z.unknown()).optional(),
});

// Session
export const createSessionSchema = z.object({
  title: z.string().min(1).max(200).optional().default('新会话'),
});

// Memory
export const createMemorySchema = z.object({
  workspaceId: z.string().length(21).nullable().optional(),
  name: z.string().min(1).max(100),
  type: z.enum(['user', 'feedback', 'project', 'reference']),
  content: z.string().min(1),
});

export const updateMemorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['user', 'feedback', 'project', 'reference']).optional(),
  content: z.string().min(1).optional(),
});

// Skill
export const createSkillSchema = z.object({
  workspaceId: z.string().length(21).nullable().optional(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  content: z.string().min(1),
});

export const updateSkillSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  content: z.string().min(1).optional(),
});

// Provider
export const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['claude', 'openai', 'deepseek']).default('claude'),
  authType: z.enum(['api_key', 'oauth']).default('api_key'),
  config: z.record(z.unknown()),
  isDefault: z.boolean().optional().default(false),
});

export const updateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

// Register（邀请码注册）
export const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  inviteCode: z.string().min(1).max(20),
});

// Invite Code（管理员创建）
export const createInviteCodeSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
  expiresAt: z.string().datetime().optional(),
});

// Scheduled Task
export const createTaskSchema = z.object({
  name: z.string().min(1).max(100),
  cron: z.string().min(1),
  prompt: z.string().min(1),
  enabled: z.boolean().optional().default(true),
});

export const updateTaskSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  cron: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

// User Preferences
export const updatePreferencesSchema = z.object({
  language: z.string().max(20).optional(),
  style: z.string().max(50).optional(),
  customRules: z.string().max(10000).optional(),
  agentModel: z.string().max(100).optional(),
  maxTokens: z.number().int().min(256).max(128000).optional(),
  contextWindowTokens: z.number().int().min(4096).max(1000000).optional(),
  temperature: z.number().min(0).max(100).optional(), // integer * 100
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  toolConfirmMode: z.enum(['always', 'smart', 'never']).optional(),
});

// Chat message
export const chatMessageSchema = z.object({
  content: z.string().min(1),
});
