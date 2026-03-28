/**
 * Agent Loop — 多轮工具执行核心循环
 *
 * 驱动 LLM 与工具之间的多轮交互：
 *   1. 向 LLM 发送消息并流式接收响应
 *   2. 解析工具调用（原生 tool_use 或 CLI 文本解析）
 *   3. 执行工具并将结果反馈给 LLM
 *   4. 重复直到 LLM 不再调用工具或达到最大迭代次数
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMToolCall,
  LLMToolResult,
  LLMToolDefinition,
  ChatParams,
  AgentStreamEvent,
  TokenUsage,
} from './providers/types.js';
import type { ToolRegistry } from './tools/registry.js';
import type { HarnessConfig } from './harness/types.js';
import { toCLIFormat, parseToolCallsFromText, looksLikeFailedToolCall } from './tools/format.js';
import type { ToolReliabilityConfig } from './harness/tool-reliability.js';
import { ToolReliabilityTracker, DEFAULT_TOOL_RELIABILITY_CONFIG } from './harness/tool-reliability.js';

// ============================================================
// Public types
// ============================================================

export interface LoopDeps {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  systemPrompt: string;
  model: string;
  maxIterations: number;
  temperature?: number;
  maxTokens?: number;
  extra?: Record<string, unknown>;
  /** 工具可靠性配置（默认全部启用） */
  reliability?: Partial<ToolReliabilityConfig>;
  /** Harness 自适应层配置（由 createAgent 根据模型 Profile 自动生成） */
  harnessConfig?: HarnessConfig;
}

export type StreamCallback = (event: AgentStreamEvent) => void;

// ============================================================
// Constants
// ============================================================

/** 连续工具执行错误次数上限，超过后停止循环 */
const MAX_CONSECUTIVE_ERRORS = 3;

/** L3 重试时注入的纠错提示 */
const TOOL_CALL_RETRY_PROMPT =
  '你上一次的工具调用格式有误，无法解析。正确格式是：<tool name="工具名">{"参数": "值"}</tool>。请重新调用工具。';

// ============================================================
// Agent Loop
// ============================================================

/**
 * 运行 Agent 循环。
 *
 * 每轮循环：流式调用 LLM → 收集响应 → 解析工具调用 → 执行工具 → 反馈结果。
 * 所有事件通过 onStream 回调实时推送给调用方。
 */
export async function runAgentLoop(
  message: string,
  onStream: StreamCallback,
  deps: LoopDeps,
): Promise<void> {
  const {
    provider,
    toolRegistry,
    systemPrompt,
    model,
    maxIterations,
    temperature,
    maxTokens,
    extra,
  } = deps;

  // 合并可靠性配置
  const reliabilityConfig: ToolReliabilityConfig = {
    ...DEFAULT_TOOL_RELIABILITY_CONFIG,
    ...deps.reliability,
  };
  const tracker = reliabilityConfig.metrics ? new ToolReliabilityTracker() : null;

  // Harness 自适应：forceCliMode 强制走 CLI 文本解析，绕过原生 function calling
  const harness = deps.harnessConfig;
  const supportsToolUse = (harness?.forceCliMode)
    ? false
    : provider.capabilities().toolUse;

  // 构建工具定义（LLM 格式）
  const toolDefs = toolRegistry.getDefinitions();
  const llmTools: LLMToolDefinition[] = toolDefs.map((t) => ({
    name: t.name,
    description: t.description,
    schema: (t.schema as unknown as Record<string, unknown>) ?? {},
  }));

  // 初始化消息数组
  const messages: LLMMessage[] = [
    { role: 'user', content: message },
  ];

  // 累计 token 用量
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  // L3 重试计数器（解析失败时注入纠错提示的次数）
  let parseRetryCount = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // ---- 构建请求参数 ----
    let effectiveSystemPrompt = systemPrompt;

    const chatParams: ChatParams = {
      model,
      messages,
      systemPrompt: effectiveSystemPrompt,
      maxTokens,
      temperature,
      extra,
    };

    if (supportsToolUse && llmTools.length > 0) {
      // 原生 tool_use 模式：通过 API 参数传递工具定义
      chatParams.tools = llmTools;
    } else if (llmTools.length > 0) {
      // CLI 模式：将工具定义注入 system prompt
      const toolsBlock = toCLIFormat(toolDefs);
      effectiveSystemPrompt = effectiveSystemPrompt
        ? `${effectiveSystemPrompt}\n\n${toolsBlock}`
        : toolsBlock;
      chatParams.systemPrompt = effectiveSystemPrompt;
    }

    // ---- 流式调用 LLM ----
    let assistantText = '';
    let thinkingText = '';
    const pendingToolCalls = new Map<string, { name: string; argsJson: string }>();

    for await (const event of provider.stream(chatParams)) {
      // 转发所有 LLM 事件
      onStream(event);

      switch (event.type) {
        case 'text_delta':
          assistantText += event.delta;
          break;

        case 'thinking_delta':
          thinkingText += event.delta;
          break;

        case 'tool_use_start':
          pendingToolCalls.set(event.toolCallId, {
            name: event.name,
            argsJson: '',
          });
          break;

        case 'tool_use_delta': {
          const pending = pendingToolCalls.get(event.toolCallId);
          if (pending) {
            pending.argsJson += event.delta;
          }
          break;
        }

        case 'usage':
          totalUsage.inputTokens += event.usage.inputTokens;
          totalUsage.outputTokens += event.usage.outputTokens;
          break;

        // tool_use_end, done, error — 已经通过 onStream 转发
        default:
          break;
      }
    }

    // ---- 解析工具调用 ----
    let toolCalls: LLMToolCall[] = [];

    if (supportsToolUse) {
      // 原生模式：从流事件中收集
      for (const [id, tc] of pendingToolCalls) {
        let input: unknown = {};
        if (tc.argsJson) {
          try {
            input = JSON.parse(tc.argsJson);
          } catch {
            input = { _raw: tc.argsJson };
          }
        }
        toolCalls.push({ id, name: tc.name, input });
      }
    } else {
      // CLI 模式：从文本中解析
      const parsed = parseToolCallsFromText(assistantText);
      toolCalls = parsed.map((p, i) => ({
        id: `cli_${iteration}_${i}`,
        name: p.name,
        input: p.input,
      }));
    }

    // Harness 自适应：singleToolPerTurn 限制每轮只执行第一个工具调用
    if (harness?.singleToolPerTurn && toolCalls.length > 1) {
      toolCalls = [toolCalls[0]];
    }

    // ---- 追加 assistant 消息 ----
    const assistantMsg: LLMMessage = {
      role: 'assistant',
      content: assistantText,
    };
    if (toolCalls.length > 0) {
      assistantMsg.toolCalls = toolCalls;
    }
    messages.push(assistantMsg);

    // ---- 无工具调用 → 检查是否需要 L3 重试 ----
    if (toolCalls.length === 0) {
      // L3: 如果文本看起来有工具调用意图但解析失败，注入纠错提示让 LLM 重试
      if (
        reliabilityConfig.retryOnParseError &&
        !supportsToolUse &&
        parseRetryCount < reliabilityConfig.maxRetries &&
        looksLikeFailedToolCall(assistantText)
      ) {
        parseRetryCount++;
        tracker?.recordParseError();
        tracker?.recordRetry();

        // 注入纠错提示作为 user 消息，继续循环
        messages.push({ role: 'user', content: TOOL_CALL_RETRY_PROMPT });
        // 不计入正常迭代：回退 iteration 计数
        iteration--;
        continue;
      }

      onStream({ type: 'session_done', usage: totalUsage });
      return;
    }

    // 解析成功，重置重试计数
    parseRetryCount = 0;

    // ---- 执行工具 ----
    const toolResults: LLMToolResult[] = [];
    let consecutiveErrors = 0;

    for (const tc of toolCalls) {
      const input = (tc.input ?? {}) as Record<string, unknown>;
      const output = await toolRegistry.execute(tc.name, input);

      const isError = output.startsWith('Error:');
      if (isError) {
        consecutiveErrors++;
      } else {
        consecutiveErrors = 0;
      }

      // 记录调用指标
      tracker?.recordCall(tc.name, !isError);

      toolResults.push({ toolCallId: tc.id, output });

      // 通过回调推送工具结果
      onStream({ type: 'tool_result', toolCallId: tc.id, output });

      // 连续错误过多，提前终止
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        break;
      }
    }

    // ---- 追加工具结果消息 ----
    const toolMsg: LLMMessage = {
      role: 'tool',
      content: toolResults.map((r) => r.output).join('\n'),
      toolResults,
    };
    messages.push(toolMsg);

    // 连续错误过多，停止循环
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      onStream({ type: 'session_done', usage: totalUsage });
      return;
    }
  }

  // 达到最大迭代次数
  onStream({ type: 'session_done', usage: totalUsage });
}
