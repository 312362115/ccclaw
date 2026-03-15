// 三种 dialect 共享的枚举值和类型常量
export const SYSTEM_ROLES = ['admin', 'user'] as const;
export const SESSION_STATUSES = ['active', 'archived'] as const;
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
export const TASK_RUN_STATUSES = ['running', 'success', 'failed'] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type MemoryType = (typeof MEMORY_TYPES)[number];
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];
