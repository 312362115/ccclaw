/**
 * 从 @agent-core/sdk 重导出共享类型。
 *
 * 迁移期间，agent-runtime 内部模块可从此处导入通用类型，
 * 逐步替换本地 llm/types.ts 中的重复定义。
 *
 * 命名加 Core 前缀以避免与 agent-runtime 现有同名类型冲突。
 */
export type {
  Tool,
  ToolSchema,
  ToolDefinition,
  AgentStreamEvent as CoreAgentStreamEvent,
  LLMStreamEvent as CoreLLMStreamEvent,
  TokenUsage as CoreTokenUsage,
  ModelProfile as CoreModelProfile,
} from '@agent-core/sdk';
