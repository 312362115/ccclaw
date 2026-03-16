/**
 * Agent Loop — 真实 AI Agent 执行循环
 *
 * 流程：
 * 1. 追加用户消息到 workspace.db
 * 2. 组装上下文（ContextAssembler）
 * 3. 迭代调用 LLM + 执行工具
 * 4. 整合检查（Consolidator）
 */

import type { AgentRequest, AgentResponse } from './protocol.js';
import type { WorkspaceDB } from './workspace-db.js';
import type { ContextAssembler, ServerContext } from './context-assembler.js';
import type { ToolRegistry } from './tool-registry.js';
import type { Consolidator } from './consolidator.js';
import type { LLMClient, LLMMessage, LLMToolCall, LLMToolDefinition } from './llm-client.js';
import type { MCPManager } from './mcp-manager.js';

// ====== Types ======

export type StreamCallback = (msg: AgentResponse) => void;

export interface AgentDeps {
  db: WorkspaceDB;
  assembler: ContextAssembler;
  toolRegistry: ToolRegistry;
  consolidator: Consolidator;
  llmClient: LLMClient | null;
  mcpManager: MCPManager | null;
  maxIterations?: number;
}

// ====== Constants ======

const DEFAULT_MAX_ITERATIONS = 50;

// ====== Agent Loop ======

export async function runAgent(
  request: AgentRequest,
  onStream: StreamCallback,
  deps?: AgentDeps,
): Promise<void> {
  // 兼容：无 deps 时回退到 echo 模式
  if (!deps || !deps.llmClient) {
    onStream({ type: 'text_delta', text: `[echo] ${request.params.message}` });
    onStream({ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } });
    return;
  }

  const { db, assembler, toolRegistry, consolidator, llmClient, mcpManager, maxIterations } = deps;
  const { sessionId, message, context } = request.params;
  const iterLimit = maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    // 确保 MCP Server 已连接
    if (mcpManager) {
      await mcpManager.ensureConnected();
    }

    // 1. 追加用户消息
    db.appendMessage({ session_id: sessionId, role: 'user', content: message });

    // 2. 组装上下文
    const serverContext: ServerContext = {
      workspaceId: context.systemPrompt, // 临时：从旧协议适配
      workspaceName: '',
      userPreferences: {},
    };
    const ctx = assembler.assemble({ sessionId, serverContext });

    // 3. 转换工具定义为 LLM 格式
    const llmTools: LLMToolDefinition[] = ctx.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema ? (t.schema as unknown as Record<string, unknown>) : undefined,
    }));

    // 4. Agent 迭代循环
    let iteration = 0;
    const messages: LLMMessage[] = ctx.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
    }));

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (iteration < iterLimit) {
      iteration++;

      const response = await llmClient.call({
        systemPrompt: ctx.systemPrompt,
        messages,
        tools: llmTools.length > 0 ? llmTools : undefined,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // 流式输出文本
      if (response.content) {
        onStream({ type: 'text_delta', text: response.content });
        db.appendMessage({ session_id: sessionId, role: 'assistant', content: response.content });
        messages.push({ role: 'assistant', content: response.content });
      }

      // 工具调用
      if (response.toolCalls.length > 0) {
        // 记录 assistant 消息（含 tool_calls）
        if (!response.content) {
          const assistantMsg: LLMMessage = {
            role: 'assistant',
            content: '',
            tool_calls: response.toolCalls,
          };
          messages.push(assistantMsg);
          db.appendMessage({
            session_id: sessionId,
            role: 'assistant',
            content: '',
            tool_calls: JSON.stringify(response.toolCalls),
          });
        }

        for (const call of response.toolCalls) {
          onStream({ type: 'tool_use', tool: call.name, input: call.params });

          const result = await toolRegistry.execute(call.name, call.params);

          onStream({ type: 'tool_result', tool: call.name, output: result });

          // 追加 tool result 到消息
          messages.push({
            role: 'tool',
            content: result,
            tool_use_id: call.id,
          });

          db.appendMessage({
            session_id: sessionId,
            role: 'tool',
            content: result,
            tool_calls: JSON.stringify({ id: call.id, name: call.name }),
          });
        }
      } else {
        // 无工具调用 = 对话结束
        break;
      }
    }

    // 5. 整合检查
    await consolidator.consolidateIfNeeded(sessionId);

    onStream({
      type: 'done',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    onStream({ type: 'error', message: `Agent 执行错误: ${message}` });
  }
}
