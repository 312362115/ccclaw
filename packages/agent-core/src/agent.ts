/**
 * createAgent() — 公共工厂函数
 *
 * 将 Provider、ToolRegistry、ProfileRegistry、ContextAssembler、AgentLoop
 * 组装为一个简洁的 Agent 对象，对外暴露 run() 和 stream() 两个方法。
 */

import type { AgentConfig, AgentResult, Agent } from './types.js';
import type { AgentStreamEvent, TokenUsage, LLMToolCall } from './providers/types.js';
import { createProvider } from './providers/factory.js';
import { ToolRegistry } from './tools/registry.js';
import { ProfileRegistry } from './profiles/registry.js';
import { assembleSystemPrompt } from './context/assembler.js';
import { runAgentLoop } from './agent-loop.js';
import type { LoopDeps } from './agent-loop.js';

/** 默认最大迭代轮次 */
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * 创建 Agent 实例。
 *
 * 1. 创建 LLM Provider
 * 2. 注册工具
 * 3. 解析模型 Profile
 * 4. 组装系统提示词
 * 5. 返回实现 Agent 接口的对象
 */
export function createAgent(config: AgentConfig): Agent {
  // ---- 1. Provider ----
  const provider = createProvider({
    type: config.provider ?? 'compat',
    apiKey: config.apiKey,
    apiBase: config.apiBase,
    defaultModel: config.model,
  });

  // ---- 2. 工具注册 ----
  const toolRegistry = new ToolRegistry();
  if (config.tools) {
    for (const tool of config.tools) {
      toolRegistry.register(tool);
    }
  }

  // ---- 3. Profile 解析 ----
  const profileRegistry = new ProfileRegistry();
  const profile = profileRegistry.resolve(config.model);

  // ---- 4. 系统提示词组装 ----
  const systemPrompt = assembleSystemPrompt({
    userPrompt: config.systemPrompt,
    profile,
    toolDefs: toolRegistry.getDefinitions(),
    enhancements: config.promptEnhancements
      ? { toolUseGuidance: true }
      : undefined,
  });

  // ---- 5. 扩展参数（thinking 等） ----
  const extra: Record<string, unknown> = {};
  if (config.thinking && profile.capabilities.extendedThinking) {
    extra.enable_thinking = true;
    extra.thinking_budget = config.thinking.budgetTokens;
  }

  // ---- 6. 构建 LoopDeps ----
  const deps: LoopDeps = {
    provider,
    toolRegistry,
    systemPrompt,
    model: config.model,
    maxIterations: config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };

  // ---- 7. 返回 Agent 对象 ----
  return {
    async run(message: string): Promise<AgentResult> {
      let finalText = '';
      const allToolCalls: LLMToolCall[] = [];
      const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      let iterations = 0;

      const onStream = (event: AgentStreamEvent): void => {
        // 转发给用户回调
        config.onEvent?.(event);

        switch (event.type) {
          case 'text_delta':
            finalText += event.delta;
            break;
          case 'tool_result':
            allToolCalls.push({
              id: event.toolCallId,
              name: '',
              input: {},
            });
            break;
          case 'done':
            iterations++;
            break;
          case 'session_done':
            totalUsage.inputTokens = event.usage.inputTokens;
            totalUsage.outputTokens = event.usage.outputTokens;
            break;
          default:
            break;
        }
      };

      await runAgentLoop(message, onStream, deps);

      return {
        text: finalText,
        toolCalls: allToolCalls,
        usage: totalUsage,
        iterations,
      };
    },

    async *stream(message: string): AsyncGenerator<AgentStreamEvent> {
      // 基于队列模式的 AsyncGenerator 实现
      const queue: AgentStreamEvent[] = [];
      let done = false;
      let resolve: (() => void) | null = null;

      const onStream = (event: AgentStreamEvent): void => {
        // 转发给用户回调
        config.onEvent?.(event);

        queue.push(event);
        if (event.type === 'session_done') {
          done = true;
        }
        // 唤醒等待中的消费者
        if (resolve) {
          const r = resolve;
          resolve = null;
          r();
        }
      };

      // 在后台启动 agent loop
      const loopPromise = runAgentLoop(message, onStream, deps).catch(
        (err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          queue.push({ type: 'error', error, message: error.message });
          done = true;
          if (resolve) {
            const r = resolve;
            resolve = null;
            r();
          }
        },
      );

      // 逐事件消费队列
      while (true) {
        if (queue.length > 0) {
          const event = queue.shift()!;
          yield event;
          if (event.type === 'session_done' || event.type === 'error') {
            break;
          }
        } else if (done) {
          break;
        } else {
          // 队列为空，等待新事件
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      }

      // 确保 loop 完成
      await loopPromise;
    },
  };
}
