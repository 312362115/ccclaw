// Agent SDK 封装 — 当前为 echo 占位实现，Task 17 替换为真正的 Claude Code SDK 调用
import type { AgentRequest, AgentResponse } from './protocol.js';

export type StreamCallback = (msg: AgentResponse) => void;

/**
 * 执行一次 Agent 对话
 * 当前为占位实现：将用户消息原样回显，用于验证整条通信链路
 * Task 17 中接入 @anthropic-ai/claude-code SDK
 */
export async function runAgent(
  request: AgentRequest,
  onStream: StreamCallback,
): Promise<void> {
  const { message } = request.params;

  // 回显用户消息（占位）
  onStream({
    type: 'text_delta',
    text: `[echo] ${message}`,
  });

  onStream({
    type: 'done',
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}
