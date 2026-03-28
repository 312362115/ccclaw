/**
 * Bridge between agent-core and ccclaw agent-runtime.
 *
 * agent-runtime 保留 ccclaw 专有逻辑（Runner 协议、WebSocket 通信、
 * 意图分类、计划执行等），agent-core 提供通用 Agent 基座。
 *
 * 本模块演示集成路径：现有 agent.ts 继续工作，后续重构可逐步
 * 将通用能力迁移到 agent-core，此处作为迁移入口。
 */
import { createAgent, type AgentConfig, type Agent } from 'agent-core-sdk';

export interface CCCLawAgentConfig {
  modelId: string;
  apiKey: string;
  apiBase?: string;
  workspaceDir?: string;
  customInstructions?: string;
}

/**
 * 基于 agent-core 创建 CCCLaw Agent 实例。
 *
 * 当前仅做薄封装，后续可在此注册 ccclaw 专用工具（文件操作、
 * 终端管理、代码索引等）并接入 Runner 协议。
 */
export function createCCCLawAgent(config: CCCLawAgentConfig): Agent {
  return createAgent({
    model: config.modelId,
    apiKey: config.apiKey,
    apiBase: config.apiBase,
    systemPrompt: config.customInstructions,
    tools: [], // ccclaw 工具后续在此注册
    promptEnhancements: true,
  });
}
