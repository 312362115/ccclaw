/**
 * Agent Loop — 真实 AI Agent 执行循环
 *
 * 流程：
 * 1. Intent 分类（stop / correction / continue）
 * 2. 追加用户消息到 workspace.db
 * 3. 上下文整合（Consolidator，在组装前压缩旧消息）
 * 4. 组装上下文（ContextAssembler）
 * 5. 迭代调用 LLMProvider.stream() + 执行工具
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
  ContentBlock,
} from './llm/types.js';
import { getTextContent } from './llm/types.js';
import { classifyIntent } from './intent.js';
import { toCLIFormat, parseToolCallsFromText } from './tool-format.js';
import { getProfileRegistry } from './llm/factory.js';
import type { ModelProfile, AgentPhase } from './llm/model-profile.js';
import { shouldPlan, generatePlan, parsePlan, buildStepContext, formatPlanForDisplay } from './planner.js';
import type { Plan, StepResult } from './planner.js';
import { PLANNING_SYSTEM_PROMPT } from './prompts/planning.js';

// ====== Types ======

export type StreamCallback = (event: AgentStreamEvent) => void;

export interface AgentDeps {
  provider: LLMProvider | null;
  db: WorkspaceDB;
  assembler: ContextAssembler;
  toolRegistry: ToolRegistry;
  consolidator: Consolidator;
  mcpManager: MCPManager | null;
  serverContext?: ServerContext;
  maxIterations?: number;
}

// ====== Constants ======

const DEFAULT_MAX_ITERATIONS = 25;
const MAX_CONSECUTIVE_TOOL_ERRORS = 3;

const PLAN_MODE_SUFFIX = `

## 当前处于计划模式

你现在处于 **计划模式**。请：
1. 分析用户的需求，理解目标
2. 列出实现步骤（编号列表），每步包含：要改什么文件、做什么改动、为什么
3. 标注步骤间的依赖关系
4. 评估风险和边界情况

**不要执行任何工具调用**，只输出计划文本。用户确认后再执行。
输出格式：先一句话概述方案，然后列出分步计划。`;

const PLAN_EXECUTE_SUFFIX = `

## 执行计划

用户已确认上面的计划。请按照之前制定的计划，逐步执行。每完成一步，简要说明完成情况再继续下一步。`;

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

  const { db, assembler, toolRegistry, consolidator, provider, mcpManager, serverContext: depsServerContext, maxIterations } = deps;
  const { sessionId, message, content: multimodalContent } = request.params;
  const iterLimit = maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    // 0. Intent 分类
    const intent = classifyIntent(message, sessionId);
    if (intent === 'stop') {
      onStream({ type: 'session_done', usage: { inputTokens: 0, outputTokens: 0 } });
      return;
    }
    // correction: 标记上一轮无效，然后继续（后续可扩展）
    const isPlanMode = intent === 'plan';
    const isPlanExecute = intent === 'plan_execute';

    // 通知前端 plan 模式状态
    if (isPlanMode) {
      onStream({ type: 'plan_mode', active: true });
    } else if (isPlanExecute) {
      onStream({ type: 'plan_mode', active: false });
    }

    // 确保 MCP Server 已连接
    if (mcpManager) {
      await mcpManager.ensureConnected();
    }

    // 0. 确保 session 存在（前端可能传入新的 sessionId）
    if (!db.getSession(sessionId)) {
      db.createSessionWithId(sessionId, { workspace_id: 'default', user_id: 'default', title: '新会话' });
    }

    // 1. 追加用户消息（DB 存纯文本，多模态内容只在本次 LLM 调用中使用）
    db.appendMessage({ session_id: sessionId, role: 'user', content: message });

    // 2. 上下文整合（在组装前压缩，用当前消息作为相关性评分的任务提示）
    consolidator.setCurrentTaskHint(message);
    toolRegistry.enterRestrictedMode(['memory_write', 'memory_read', 'memory_search']);
    try {
      await consolidator.consolidateIfNeeded(sessionId);
    } finally {
      toolRegistry.exitRestrictedMode();
    }

    // 3. 组装上下文（serverContext 由 RuntimeConfig 注入，ModelProfile 驱动 prompt 策略）
    const serverContext: ServerContext = depsServerContext ?? {
      workspaceId: '',
      workspaceName: '',
      userPreferences: {},
    };
    const currentModel: string = (provider as any).defaultModel || 'claude-sonnet-4-20250514';
    const profileRegistry = getProfileRegistry();
    const modelProfile = profileRegistry.resolve(currentModel);
    const assemblePhase: AgentPhase = isPlanMode ? 'planning' : 'coding';

    const ctx = assembler.assemble({
      sessionId,
      serverContext,
      modelProfile,
      phase: assemblePhase,
    });

    // 4. 获取 provider 能力
    const caps: ProviderCapabilities = provider.capabilities();

    // 5. 转换工具定义（plan 模式下不传工具，只生成计划）
    const toolDefs = isPlanMode ? [] : ctx.tools;

    // Plan 模式：使用专用 planning prompt 引导结构化输出
    if (isPlanMode) {
      ctx.systemPrompt = PLANNING_SYSTEM_PROMPT;
    }

    // Plan Execute 模式：尝试从上一轮 assistant 消息中解析 Plan，逐步执行
    let activePlan: Plan | null = null;
    if (isPlanExecute) {
      // 查找最近的 assistant 消息（应包含 Plan JSON）
      const recentMessages = ctx.messages;
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        if (recentMessages[i].role === 'assistant') {
          activePlan = parsePlan(recentMessages[i].content);
          break;
        }
      }

      if (activePlan) {
        // 注入第一步的 context
        const stepCtx = buildStepContext(activePlan, 0, []);
        ctx.systemPrompt = (ctx.systemPrompt || '') + stepCtx;
        onStream({ type: 'text_delta', delta: `📋 计划已解析（${activePlan.steps.length} 步），开始执行...\n\n` });
      } else {
        // 解析失败，回退到旧模式
        ctx.systemPrompt = (ctx.systemPrompt || '') + PLAN_EXECUTE_SUFFIX;
      }
    }

    // 6. Agent 迭代循环
    let iteration = 0;
    let consecutiveToolErrors = 0;
    // Plan 步骤跟踪
    let currentPlanStep = 0;
    const planStepResults: StepResult[] = [];
    const history: LLMMessage[] = ctx.messages.map((m, i, arr) => {
      // 对最后一条 user 消息注入多模态内容（如果有）
      if (multimodalContent && i === arr.length - 1 && m.role === 'user') {
        const blocks: ContentBlock[] = [
          { type: 'text', text: m.content },
          ...multimodalContent,
        ];
        return { role: m.role as 'user', content: blocks } as LLMMessage;
      }
      return {
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
      };
    });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Plan 模式只需 1 轮 LLM 调用
    const effectiveIterLimit = isPlanMode ? 1 : iterLimit;

    while (iteration < effectiveIterLimit) {
      iteration++;

      // 构建 ChatParams — 从 ModelProfile 读取推荐参数（复用外层变量）
      const currentPhase: AgentPhase = isPlanMode ? 'planning' : 'coding';
      const phaseParams = profileRegistry.getPhaseParams(currentModel, currentPhase);

      const chatParams: ChatParams = {
        model: currentModel,
        messages: history,
        systemPrompt: ctx.systemPrompt,
        maxTokens: phaseParams.maxTokens,
        temperature: phaseParams.temperature,
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

      if (caps.extendedThinking) {
        chatParams.thinkingConfig = { budgetTokens: 8192 };
      }

      // 流式调用 LLM
      let stopReason: StopReason = 'end_turn';
      let assistantContent = '';
      const pendingToolCalls: LLMToolCall[] = [];
      let currentToolCall: { id: string; name: string; inputJson: string } | null = null;

      let eventCount = 0;
      for await (const event of provider.stream(chatParams)) {
        eventCount++;
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

      console.log(`[Agent] stream finished: ${eventCount} events, stopReason=${stopReason}, contentLen=${assistantContent.length}`);

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

        let allErrorsThisRound = true;
        for (const tc of pendingToolCalls) {
          const result = await toolRegistry.execute(
            tc.name,
            tc.input as Record<string, unknown>,
            {
              toolCallId: tc.id,
              onProgress: (delta) => {
                onStream({ type: 'tool_output_delta', toolCallId: tc.id, delta });
              },
            },
          );

          const isError = typeof result === 'string' && result.startsWith('Error:');
          if (!isError) allErrorsThisRound = false;

          // 工具执行失败时，发送错误恢复选项
          if (isError) {
            onStream({
              type: 'tool_error_options',
              toolCallId: tc.id,
              error: result,
              options: ['retry_fix', 'change_approach', 'manual'],
            });
          }

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

        // 连续工具失败检测
        if (allErrorsThisRound) {
          consecutiveToolErrors++;
          if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
            onStream({ type: 'error', message: `工具连续失败 ${consecutiveToolErrors} 次，终止执行` });
            break;
          }
        } else {
          consecutiveToolErrors = 0;
        }
        // 继续循环
      } else {
        // 无工具调用 = 当前步骤结束
        if (assistantContent) {
          history.push({ role: 'assistant', content: assistantContent });
        }

        // Plan 步骤推进：如果有 activePlan，推进到下一步
        if (activePlan && currentPlanStep < activePlan.steps.length - 1) {
          planStepResults.push({
            stepIndex: currentPlanStep + 1,
            success: true,
            summary: assistantContent.slice(0, 200),
          });
          currentPlanStep++;

          // 注入下一步的 context 到 history（作为 user 消息驱动下一轮）
          const nextStepCtx = buildStepContext(activePlan, currentPlanStep, planStepResults);
          const stepPrompt = `继续执行下一步。${nextStepCtx}`;
          history.push({ role: 'user', content: stepPrompt });
          db.appendMessage({ session_id: sessionId, role: 'user', content: stepPrompt });

          onStream({ type: 'text_delta', delta: `\n\n---\n📋 步骤 ${currentPlanStep + 1}/${activePlan.steps.length}: ${activePlan.steps[currentPlanStep].description}\n\n` });
          // 不 break，继续循环执行下一步
        } else {
          break;
        }
      }
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
