/**
 * Agent Loop — 真实 AI Agent 执行循环
 *
 * 流程：
 * 1. Intent 分类（stop / correction / continue）
 * 2. 追加用户消息到 workspace.db
 * 3. 组装上下文（ContextAssembler）
 * 4. 迭代调用 LLMProvider.stream() + 执行工具
 * 5. 整合检查（Consolidator）
 */

import type { AgentRequest } from './protocol.js';
import type { WorkspaceDB } from './workspace-db.js';
import type { ContextAssembler, ServerContext } from './context-assembler.js';
import type { ToolRegistry } from './tool-registry.js';
import type { Consolidator } from './consolidator.js';
import type { MCPManager } from './mcp-manager.js';
import type {
  LLMProvider,
  AgentStreamEvent,
  ProviderCapabilities,
  ChatParams,
  LLMToolCall,
  LLMMessage,
  StopReason,
} from './llm/types.js';
import { classifyIntent } from './intent.js';
import { toCLIFormat, parseToolCallsFromText } from './tool-format.js';

// ====== Types ======

export type StreamCallback = (event: AgentStreamEvent) => void;

export interface AgentDeps {
  provider: LLMProvider | null;
  db: WorkspaceDB;
  assembler: ContextAssembler;
  toolRegistry: ToolRegistry;
  consolidator: Consolidator;
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
  if (!deps || !deps.provider) {
    onStream({ type: 'text_delta', delta: `[echo] ${request.params.message}` });
    onStream({ type: 'session_done', usage: { inputTokens: 0, outputTokens: 0 } });
    return;
  }

  const { db, assembler, toolRegistry, consolidator, provider, mcpManager, maxIterations } = deps;
  const { sessionId, message, context } = request.params;
  const iterLimit = maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    // 0. Intent 分类
    const intent = classifyIntent(message);
    if (intent === 'stop') {
      onStream({ type: 'session_done', usage: { inputTokens: 0, outputTokens: 0 } });
      return;
    }
    // correction: 标记上一轮无效，然后继续（后续可扩展）

    // 确保 MCP Server 已连接
    if (mcpManager) {
      await mcpManager.ensureConnected();
    }

    // 0. 确保 session 存在（前端可能传入新的 sessionId）
    if (!db.getSession(sessionId)) {
      db.createSessionWithId(sessionId, { workspace_id: 'default', user_id: 'default', title: '新会话' });
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

    // 3. 获取 provider 能力
    const caps: ProviderCapabilities = provider.capabilities();

    // 4. 转换工具定义
    const toolDefs = ctx.tools;

    // 5. Agent 迭代循环
    let iteration = 0;
    const history: LLMMessage[] = ctx.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
    }));

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (iteration < iterLimit) {
      iteration++;

      // 构建 ChatParams
      const chatParams: ChatParams = {
        model:
          request.params.model ||
          context?.preferences?.agentModel ||
          'claude-sonnet-4-20250514',
        messages: history,
        systemPrompt: ctx.systemPrompt,
        maxTokens: 8192,
        temperature: 0.1,
      };

      if (caps.toolUse) {
        // Function Call 模式：通过 API 参数传递工具
        const llmTools = toolDefs
          .filter((t) => t.schema)
          .map((t) => ({
            name: t.name,
            description: t.description,
            schema: t.schema as unknown as Record<string, unknown>,
          }));
        if (llmTools.length > 0) {
          chatParams.tools = llmTools;
        }
      } else {
        // CLI 模式：将工具注入 system prompt
        if (toolDefs.length > 0) {
          chatParams.systemPrompt = (chatParams.systemPrompt || '') + '\n\n' + toCLIFormat(toolDefs);
        }
      }

      if (caps.extendedThinking && context?.preferences?.reasoningEffort) {
        chatParams.thinkingConfig = { budgetTokens: 8192 };
      }

      // 流式调用 LLM
      let stopReason: StopReason = 'end_turn';
      let assistantContent = '';
      const pendingToolCalls: LLMToolCall[] = [];
      let currentToolCall: { id: string; name: string; inputJson: string } | null = null;

      for await (const event of provider.stream(chatParams)) {
        switch (event.type) {
          case 'text_delta':
            assistantContent += event.delta;
            onStream(event);
            break;
          case 'thinking_delta':
            onStream(event);
            break;
          case 'tool_use_start':
            currentToolCall = { id: event.toolCallId, name: event.name, inputJson: '' };
            onStream(event);
            break;
          case 'tool_use_delta':
            if (currentToolCall) {
              currentToolCall.inputJson += event.delta;
            }
            onStream(event);
            break;
          case 'tool_use_end': {
            if (currentToolCall) {
              let input: unknown = {};
              try {
                input = JSON.parse(currentToolCall.inputJson || '{}');
              } catch {
                // 解析失败使用空对象
              }
              pendingToolCalls.push({
                id: currentToolCall.id,
                name: currentToolCall.name,
                input,
              });
              currentToolCall = null;
            }
            onStream(event);
            break;
          }
          case 'done':
            stopReason = event.stopReason;
            break;
          case 'usage':
            totalInputTokens += event.usage.inputTokens;
            totalOutputTokens += event.usage.outputTokens;
            break;
          case 'error':
            onStream(event);
            break;
        }
      }

      // CLI 模式：从文本中解析工具调用
      if (!caps.toolUse && assistantContent) {
        const parsed = parseToolCallsFromText(assistantContent);
        if (parsed.length > 0) {
          for (let i = 0; i < parsed.length; i++) {
            pendingToolCalls.push({
              id: `cli_${iteration}_${i}`,
              name: parsed[i].name,
              input: parsed[i].input,
            });
          }
          stopReason = 'tool_use';
        }
      }

      // 保存 assistant 消息
      if (assistantContent) {
        db.appendMessage({ session_id: sessionId, role: 'assistant', content: assistantContent });
      }

      // 工具调用处理
      if (stopReason === 'tool_use' && pendingToolCalls.length > 0) {
        // 记录 assistant 消息到 history（含 tool_calls）
        history.push({
          role: 'assistant',
          content: assistantContent || '',
          toolCalls: pendingToolCalls,
        });

        for (const tc of pendingToolCalls) {
          const result = await toolRegistry.execute(
            tc.name,
            tc.input as Record<string, unknown>,
          );

          onStream({ type: 'tool_result', toolCallId: tc.id, output: result });

          // 追加 tool result 到消息历史
          history.push({
            role: 'tool',
            content: result,
            toolResults: [{ toolCallId: tc.id, output: result }],
          });

          db.appendMessage({
            session_id: sessionId,
            role: 'tool',
            content: result,
            tool_calls: JSON.stringify({ id: tc.id, name: tc.name }),
          });
        }
        // 继续循环
      } else {
        // 无工具调用 = 对话结束
        if (assistantContent) {
          history.push({ role: 'assistant', content: assistantContent });
        }
        break;
      }
    }

    // 6. 整合检查（受限模式）
    toolRegistry.enterRestrictedMode(['memory_write', 'memory_read', 'memory_search']);
    try {
      onStream({ type: 'consolidation', summary: 'Checking context...' });
      await consolidator.consolidateIfNeeded(sessionId);
    } finally {
      toolRegistry.exitRestrictedMode();
    }

    onStream({
      type: 'session_done',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    });
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    onStream({ type: 'error', message: `Agent 执行错误: ${errMessage}` });
  }
}
