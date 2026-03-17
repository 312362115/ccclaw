# Agent Core 重构实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 agent-runtime 从 Claude SDK 绑定重构为支持任意 LLM 的通用 Agent 核心，包含多 Provider 适配、滑动窗口压缩、工具双模式、MCP 补齐、Skill 增强和 Server 侧 OAuth。

**Architecture:** Provider 适配器模式（AnthropicAdapter / OpenAIAdapter / GeminiAdapter / CompatAdapter），零 SDK 依赖，原生 fetch 直调各家 API。Agent Loop 通过 LLMProvider 接口解耦，ToolRegistry 统一管理所有工具（内置 + MCP + Skill），流式事件分两层（LLM 层 + Agent 层）。

**Tech Stack:** Node.js 22 + TypeScript + vitest + SQLite (better-sqlite3) + ws + Hono

**Spec:** `docs/specs/system-design/2026-03-17-agent-core-redesign.md`

---

## Chunk 1: LLM Provider 抽象层

### Task 1: 类型定义与接口

**Files:**
- Create: `packages/agent-runtime/src/llm/types.ts`
- Test: `packages/agent-runtime/src/llm/types.test.ts`

- [ ] **Step 1: 创建 LLM 类型定义文件**

```typescript
// packages/agent-runtime/src/llm/types.ts

export interface LLMProvider {
  chat(params: ChatParams): Promise<ChatResponse>;
  stream(params: ChatParams): AsyncIterable<LLMStreamEvent>;
  capabilities(): ProviderCapabilities;
}

export interface ChatParams {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  thinkingConfig?: { enabled: boolean; budgetTokens?: number };
  cacheControl?: CacheHint[];
}

export interface CacheHint {
  type: 'ephemeral';
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | null;
  toolCalls?: LLMToolCall[];
  toolResults?: LLMToolResult[];
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMToolResult {
  toolCallId: string;
  output: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  usage: TokenUsage;
  stopReason: StopReason;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

export type LLMStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_use_start'; toolId: string; name: string }
  | { type: 'tool_use_delta'; toolId: string; input: string }
  | { type: 'tool_use_end'; toolId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: StopReason }
  | { type: 'error'; message: string };

export type AgentStreamEvent =
  | LLMStreamEvent
  | { type: 'tool_result'; toolId: string; output: string }
  | { type: 'confirm_request'; requestId: string; tool: string; input: Record<string, unknown>; reason: string }
  | { type: 'subagent_started'; taskId: string; label: string }
  | { type: 'subagent_result'; taskId: string; output: string }
  | { type: 'consolidation'; message: string }
  | { type: 'session_done'; sessionId: string; tokens: TokenUsage };

export interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  extendedThinking: boolean;
  promptCaching: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ProviderConfig {
  type: string;          // 'claude' | 'openai' | 'gemini' | 其他
  apiKey: string;        // API Key 或 OAuth token
  apiBase?: string;      // 自定义端点
  defaultModel?: string;
}

export class ProviderConfigError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}
```

- [ ] **Step 2: 写类型测试（验证导出正确）**

```typescript
// packages/agent-runtime/src/llm/types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  LLMProvider, ChatParams, ChatResponse, LLMStreamEvent,
  AgentStreamEvent, ProviderCapabilities, ProviderConfig,
} from './types.js';
import { ProviderConfigError } from './types.js';

describe('LLM types', () => {
  it('ProviderConfigError carries field name', () => {
    const err = new ProviderConfigError('apiKey', 'API key is required');
    expect(err.field).toBe('apiKey');
    expect(err.message).toBe('API key is required');
    expect(err.name).toBe('ProviderConfigError');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `cd packages/agent-runtime && npx vitest run src/llm/types.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/agent-runtime/src/llm/types.ts packages/agent-runtime/src/llm/types.test.ts
git commit -m "feat(agent-runtime): add LLM provider type definitions"
```

---

### Task 2: BaseLLMProvider — 共享重试/消毒逻辑

**Files:**
- Create: `packages/agent-runtime/src/llm/base.ts`
- Test: `packages/agent-runtime/src/llm/base.test.ts`
- Reference: `packages/agent-runtime/src/llm-client.ts` (迁移源)

- [ ] **Step 1: 写 BaseLLMProvider 测试（迁移自 llm-client.test.ts）**

测试覆盖：
- `isTransientError()`: 429/5xx/timeout → true, 400/401 → false
- `withRetry()`: 成功、首次失败后成功、全部失败
- `sanitizeMessages()`: 空内容消毒、tool_calls 空内容保留 null
- `stripImageContent()`: 移除图片替换为文本标记

```typescript
// packages/agent-runtime/src/llm/base.test.ts
import { describe, it, expect, vi } from 'vitest';
import { isTransientError, withRetry, sanitizeMessages, stripImageContent } from './base.js';

describe('isTransientError', () => {
  it('429 rate limit is transient', () => {
    expect(isTransientError(new Error('429 rate limit'))).toBe(true);
  });
  it('500 server error is transient', () => {
    expect(isTransientError(new Error('500 internal'))).toBe(true);
  });
  it('401 unauthorized is not transient', () => {
    expect(isTransientError(new Error('401 unauthorized'))).toBe(false);
  });
  it('timeout is transient', () => {
    expect(isTransientError(new Error('request timed out'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('retries on transient error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValue('ok');
    expect(await withRetry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('throws after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503'));
    await expect(withRetry(fn)).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });
});

describe('sanitizeMessages', () => {
  it('replaces empty assistant content with (empty)', () => {
    const msgs = [{ role: 'assistant' as const, content: '', toolCalls: undefined }];
    const result = sanitizeMessages(msgs);
    expect(result[0].content).toBe('(empty)');
  });
  it('keeps null for assistant with toolCalls', () => {
    const msgs = [{ role: 'assistant' as const, content: '', toolCalls: [{ id: '1', name: 'bash', input: {} }] }];
    const result = sanitizeMessages(msgs);
    expect(result[0].content).toBeNull();
  });
});

describe('stripImageContent', () => {
  it('replaces image markers with text', () => {
    const msgs = [{ role: 'user' as const, content: 'Look at [image:base64...]' }];
    // stripImageContent removes base64 image patterns
    const result = stripImageContent(msgs);
    expect(result[0].content).not.toContain('base64');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd packages/agent-runtime && npx vitest run src/llm/base.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 实现 BaseLLMProvider**

从 `llm-client.ts` 迁移核心逻辑到 `llm/base.ts`：

```typescript
// packages/agent-runtime/src/llm/base.ts
import type { LLMMessage, LLMToolCall } from './types.js';

const RETRY_DELAYS = [1000, 2000, 4000];

export function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  const transientPatterns = ['429', 'rate limit', 'overloaded', '500', '502', '503', '504',
    'timeout', 'timed out', 'connection', 'temporarily unavailable'];
  return transientPatterns.some(p => msg.includes(p));
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof Error) || !isTransientError(err) || attempt === RETRY_DELAYS.length) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
  throw new Error('unreachable');
}

export function sanitizeMessages(messages: LLMMessage[]): LLMMessage[] {
  return messages.map(msg => {
    if (msg.role === 'assistant' && msg.toolCalls?.length && !msg.content) {
      return { ...msg, content: null };
    }
    if (msg.role === 'assistant' && !msg.content && !msg.toolCalls?.length) {
      return { ...msg, content: '(empty)' };
    }
    return msg;
  });
}

export function stripImageContent(messages: LLMMessage[]): LLMMessage[] {
  return messages.map(msg => {
    if (typeof msg.content !== 'string') return msg;
    // Remove base64 image patterns
    const stripped = msg.content.replace(/\[image:base64[^\]]*\]/g, '[图片内容已省略，当前模型不支持视觉]');
    return { ...msg, content: stripped };
  });
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd packages/agent-runtime && npx vitest run src/llm/base.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/llm/base.ts packages/agent-runtime/src/llm/base.test.ts
git commit -m "feat(agent-runtime): add BaseLLMProvider shared retry/sanitize logic"
```

---

### Task 3: AnthropicAdapter

**Files:**
- Create: `packages/agent-runtime/src/llm/anthropic.ts`
- Test: `packages/agent-runtime/src/llm/anthropic.test.ts`

- [ ] **Step 1: 写 AnthropicAdapter 测试**

测试覆盖：
- `capabilities()` 返回正确的能力集
- `chat()` 转换请求格式并解析响应
- `stream()` 解析 SSE 事件流
- 工具调用格式转换（tool_use content block）
- extended thinking 参数透传
- API Key 和 OAuth token 两种认证 header

```typescript
// packages/agent-runtime/src/llm/anthropic.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    adapter = new AnthropicAdapter({ type: 'claude', apiKey: 'sk-test' });
    mockFetch.mockReset();
  });

  it('capabilities returns Claude defaults', () => {
    const caps = adapter.capabilities();
    expect(caps.toolUse).toBe(true);
    expect(caps.extendedThinking).toBe(true);
    expect(caps.contextWindow).toBe(200000);
  });

  it('chat sends correct Anthropic format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      }),
    });

    const result = await adapter.chat({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe('Hello');
    expect(result.stopReason).toBe('end_turn');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-test',
        }),
      }),
    );
  });

  it('uses Bearer token when apiKey starts with oauth_', async () => {
    const oauthAdapter = new AnthropicAdapter({ type: 'claude', apiKey: 'oauth_abc123' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hi' }],
        usage: { input_tokens: 5, output_tokens: 2 },
        stop_reason: 'end_turn',
      }),
    });

    await oauthAdapter.chat({ model: 'claude-sonnet-4-20250514', messages: [] });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer oauth_abc123',
        }),
      }),
    );
  });

  it('parses tool_use content blocks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: 'tool_use', id: 'call_1', name: 'bash', input: { command: 'ls' } },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: 'tool_use',
      }),
    });

    const result = await adapter.chat({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'list files' }],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({ id: 'call_1', name: 'bash', input: { command: 'ls' } });
    expect(result.stopReason).toBe('tool_use');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd packages/agent-runtime && npx vitest run src/llm/anthropic.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 AnthropicAdapter**

```typescript
// packages/agent-runtime/src/llm/anthropic.ts
import type {
  LLMProvider, ChatParams, ChatResponse, LLMStreamEvent,
  ProviderCapabilities, ProviderConfig, LLMMessage, LLMToolDefinition,
} from './types.js';
import { ProviderConfigError } from './types.js';
import { withRetry, sanitizeMessages } from './base.js';

export class AnthropicAdapter implements LLMProvider {
  private apiKey: string;
  private apiBase: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) throw new ProviderConfigError('apiKey', 'API key is required for Claude');
    this.apiKey = config.apiKey;
    this.apiBase = config.apiBase || 'https://api.anthropic.com';
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      extendedThinking: true,
      promptCaching: true,
      vision: true,
      contextWindow: 200_000,
      maxOutputTokens: 8192,
    };
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const body = this.buildRequestBody(params);
    const headers = this.buildHeaders();

    const resp = await withRetry(() =>
      fetch(`${this.apiBase}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: params.signal ?? AbortSignal.timeout(120_000),
      })
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic API ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return this.parseResponse(data);
  }

  async *stream(params: ChatParams): AsyncIterable<LLMStreamEvent> {
    const body = { ...this.buildRequestBody(params), stream: true };
    const headers = this.buildHeaders();

    const resp = await withRetry(() =>
      fetch(`${this.apiBase}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: params.signal ?? AbortSignal.timeout(120_000),
      })
    );

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      yield { type: 'error', message: `Anthropic API ${resp.status}: ${text}` };
      return;
    }

    yield* this.parseSSE(resp.body);
  }

  private buildHeaders(): Record<string, string> {
    const isOAuth = this.apiKey.startsWith('oauth_');
    return {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(isOAuth
        ? { 'Authorization': `Bearer ${this.apiKey}` }
        : { 'x-api-key': this.apiKey }),
    };
  }

  private buildRequestBody(params: ChatParams): Record<string, unknown> {
    const messages = sanitizeMessages(params.messages);
    const body: Record<string, unknown> = {
      model: params.model,
      messages: messages.map(m => this.toAnthropicMessage(m)),
      max_tokens: params.maxTokens ?? 8192,
    };
    if (params.systemPrompt) body.system = params.systemPrompt;
    if (params.tools?.length) body.tools = params.tools.map(t => this.toAnthropicTool(t));
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.thinkingConfig?.enabled) {
      body.thinking = { type: 'enabled', budget_tokens: params.thinkingConfig.budgetTokens ?? 4096 };
    }
    return body;
  }

  private toAnthropicMessage(msg: LLMMessage): Record<string, unknown> {
    const content: unknown[] = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
    }
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        content.push({ type: 'tool_result', tool_use_id: tr.toolCallId, content: tr.output });
      }
    }
    return {
      role: msg.role === 'system' ? 'user' : msg.role,
      content: content.length === 1 && typeof content[0] === 'object' && (content[0] as any).type === 'text'
        ? msg.content
        : content,
    };
  }

  private toAnthropicTool(tool: LLMToolDefinition): Record<string, unknown> {
    return { name: tool.name, description: tool.description, input_schema: tool.schema };
  }

  private parseResponse(data: any): ChatResponse {
    let content: string | null = null;
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];

    for (const block of data.content || []) {
      if (block.type === 'text') content = (content || '') + block.text;
      if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }

    return {
      content,
      toolCalls,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      stopReason: data.stop_reason === 'tool_use' ? 'tool_use'
        : data.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
    };
  }

  private async *parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<LLMStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;

          try {
            const event = JSON.parse(raw);
            yield* this.mapSSEEvent(event);
            if (event.type === 'message_delta' && event.usage) {
              outputTokens = event.usage.output_tokens ?? outputTokens;
            }
            if (event.type === 'message_start' && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens ?? 0;
            }
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'usage', inputTokens, outputTokens };
  }

  private *mapSSEEvent(event: any): Iterable<LLMStreamEvent> {
    if (event.type === 'content_block_start') {
      if (event.content_block?.type === 'tool_use') {
        yield { type: 'tool_use_start', toolId: event.content_block.id, name: event.content_block.name };
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta') {
        yield { type: 'text_delta', content: event.delta.text };
      } else if (event.delta?.type === 'thinking_delta') {
        yield { type: 'thinking_delta', content: event.delta.thinking };
      } else if (event.delta?.type === 'input_json_delta') {
        yield { type: 'tool_use_delta', toolId: event.index?.toString() ?? '', input: event.delta.partial_json };
      }
    } else if (event.type === 'content_block_stop') {
      if (event.content_block?.type === 'tool_use' || event.index !== undefined) {
        yield { type: 'tool_use_end', toolId: event.index?.toString() ?? '' };
      }
    } else if (event.type === 'message_delta') {
      const sr = event.delta?.stop_reason;
      yield { type: 'done', stopReason: sr === 'tool_use' ? 'tool_use' : sr === 'max_tokens' ? 'max_tokens' : 'end_turn' };
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd packages/agent-runtime && npx vitest run src/llm/anthropic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/llm/anthropic.ts packages/agent-runtime/src/llm/anthropic.test.ts
git commit -m "feat(agent-runtime): add AnthropicAdapter with fetch-based API calls"
```

---

### Task 4: OpenAIAdapter

**Files:**
- Create: `packages/agent-runtime/src/llm/openai.ts`
- Test: `packages/agent-runtime/src/llm/openai.test.ts`

- [ ] **Step 1: 写 OpenAIAdapter 测试**

测试覆盖：
- `capabilities()` 返回 OpenAI 默认值（contextWindow=128000, extendedThinking=false）
- `chat()` 发送 Chat Completions 格式，解析 `choices[0].message`
- `stream()` 解析 `data: {"choices":[{"delta":...}]}` SSE
- 工具调用：`tool_calls` 字段解析
- Authorization Bearer header

- [ ] **Step 2: 运行测试验证失败**

- [ ] **Step 3: 实现 OpenAIAdapter**

结构同 AnthropicAdapter，区别：
- 端点：`/v1/chat/completions`
- 消息格式：`{ role, content, tool_calls? }`
- 工具格式：`{ type: 'function', function: { name, description, parameters } }`
- 响应：`choices[0].message.content` + `choices[0].message.tool_calls`
- SSE：`data: {"choices":[{"delta":{"content":"..."}}]}`

- [ ] **Step 4: 运行测试验证通过**

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/llm/openai.ts packages/agent-runtime/src/llm/openai.test.ts
git commit -m "feat(agent-runtime): add OpenAIAdapter for Chat Completions API"
```

---

### Task 5: GeminiAdapter

**Files:**
- Create: `packages/agent-runtime/src/llm/gemini.ts`
- Test: `packages/agent-runtime/src/llm/gemini.test.ts`

- [ ] **Step 1: 写 GeminiAdapter 测试**

测试覆盖：
- `capabilities()` 返回 Gemini 默认值（vision=true, extendedThinking=false）
- `chat()` 发送 `generateContent` 格式
- 工具格式：`functionDeclarations` Schema 对象转换
- 工具结果：`functionResponse` parts
- `safetyRatings` 拦截检测
- OAuth Bearer header

- [ ] **Step 2-4: 实现 + 测试通过**

关键差异：
- 端点：`/v1beta/models/{model}:generateContent`
- 消息：`contents[].parts[]`，text 和 functionCall 可在同一 candidate 中
- 工具定义：`functionDeclarations` 使用 Gemini Schema 格式
- 工具结果：`functionResponse` part（不是独立 message）
- 流式：`/v1beta/models/{model}:streamGenerateContent?alt=sse`

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/llm/gemini.ts packages/agent-runtime/src/llm/gemini.test.ts
git commit -m "feat(agent-runtime): add GeminiAdapter for Gemini API"
```

---

### Task 6: CompatAdapter + Factory

**Files:**
- Create: `packages/agent-runtime/src/llm/compat.ts`
- Create: `packages/agent-runtime/src/llm/factory.ts`
- Create: `packages/agent-runtime/src/llm/index.ts`
- Test: `packages/agent-runtime/src/llm/factory.test.ts`

- [ ] **Step 1: 写 CompatAdapter（继承 OpenAIAdapter）**

```typescript
// packages/agent-runtime/src/llm/compat.ts
import { OpenAIAdapter } from './openai.js';
import type { ProviderConfig, ProviderCapabilities } from './types.js';

export class CompatAdapter extends OpenAIAdapter {
  constructor(config: ProviderConfig) {
    if (!config.apiBase) {
      throw new Error('CompatAdapter requires apiBase');
    }
    super(config);
  }

  capabilities(): ProviderCapabilities {
    return {
      ...super.capabilities(),
      extendedThinking: false,
      promptCaching: false,
      // 兼容模式保守估计
      contextWindow: 32_000,
      maxOutputTokens: 4096,
    };
  }
}
```

- [ ] **Step 2: 写 Factory 测试**

```typescript
// packages/agent-runtime/src/llm/factory.test.ts
import { describe, it, expect } from 'vitest';
import { LLMProviderFactory } from './factory.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { GeminiAdapter } from './gemini.js';
import { CompatAdapter } from './compat.js';
import { ProviderConfigError } from './types.js';

describe('LLMProviderFactory', () => {
  it('creates AnthropicAdapter for type=claude', () => {
    const provider = LLMProviderFactory.create({ type: 'claude', apiKey: 'sk-test' });
    expect(provider).toBeInstanceOf(AnthropicAdapter);
  });

  it('creates OpenAIAdapter for type=openai', () => {
    const provider = LLMProviderFactory.create({ type: 'openai', apiKey: 'sk-test' });
    expect(provider).toBeInstanceOf(OpenAIAdapter);
  });

  it('creates GeminiAdapter for type=gemini', () => {
    const provider = LLMProviderFactory.create({ type: 'gemini', apiKey: 'token' });
    expect(provider).toBeInstanceOf(GeminiAdapter);
  });

  it('falls back to CompatAdapter for unknown type with apiBase', () => {
    const provider = LLMProviderFactory.create({ type: 'deepseek', apiKey: 'sk-test', apiBase: 'https://api.deepseek.com' });
    expect(provider).toBeInstanceOf(CompatAdapter);
  });

  it('throws ProviderConfigError when apiKey missing', () => {
    expect(() => LLMProviderFactory.create({ type: 'claude', apiKey: '' }))
      .toThrow(ProviderConfigError);
  });
});
```

- [ ] **Step 3: 实现 Factory**

```typescript
// packages/agent-runtime/src/llm/factory.ts
import type { LLMProvider, ProviderConfig } from './types.js';
import { ProviderConfigError } from './types.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { GeminiAdapter } from './gemini.js';
import { CompatAdapter } from './compat.js';

export class LLMProviderFactory {
  static create(config: ProviderConfig): LLMProvider {
    if (!config.apiKey) {
      throw new ProviderConfigError('apiKey', 'API key or token is required');
    }
    switch (config.type) {
      case 'claude': return new AnthropicAdapter(config);
      case 'openai': return new OpenAIAdapter(config);
      case 'gemini': return new GeminiAdapter(config);
      default:
        // 未知 type 降级为 CompatAdapter
        if (!config.apiBase) {
          throw new ProviderConfigError('apiBase', `Unknown provider type "${config.type}" requires apiBase`);
        }
        return new CompatAdapter(config);
    }
  }
}
```

- [ ] **Step 4: 写 index.ts barrel export**

```typescript
// packages/agent-runtime/src/llm/index.ts
export * from './types.js';
export * from './base.js';
export * from './factory.js';
export * from './anthropic.js';
export * from './openai.js';
export * from './gemini.js';
export * from './compat.js';
```

- [ ] **Step 5: 运行全部 LLM 测试**

Run: `cd packages/agent-runtime && npx vitest run src/llm/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime/src/llm/
git commit -m "feat(agent-runtime): add LLMProviderFactory with 4 adapters (claude/openai/gemini/compat)"
```

---

## Chunk 2: Agent Loop 重构 + Intent + 工具格式

### Task 7: Intent 快速分类

**Files:**
- Create: `packages/agent-runtime/src/intent.ts`
- Test: `packages/agent-runtime/src/intent.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/agent-runtime/src/intent.test.ts
import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intent.js';

describe('classifyIntent', () => {
  it('/stop returns stop', () => expect(classifyIntent('/stop')).toBe('stop'));
  it('/cancel returns stop', () => expect(classifyIntent('/cancel')).toBe('stop'));
  it('停止 returns stop', () => expect(classifyIntent('停止')).toBe('stop'));
  it('取消 returns stop', () => expect(classifyIntent('取消')).toBe('stop'));
  it('/retry returns correction', () => expect(classifyIntent('/retry')).toBe('correction'));
  it('重来 returns correction', () => expect(classifyIntent('重来')).toBe('correction'));
  it('重试 returns correction', () => expect(classifyIntent('重试')).toBe('correction'));
  it('normal message returns continue', () => expect(classifyIntent('写一个函数')).toBe('continue'));
  it('重新设计组件 returns continue (not correction)', () => expect(classifyIntent('重新设计组件')).toBe('continue'));
  it('不对称加密 returns continue (not correction)', () => expect(classifyIntent('不对称加密')).toBe('continue'));
  it('whitespace trimmed', () => expect(classifyIntent('  /stop  ')).toBe('stop'));
  it('case insensitive', () => expect(classifyIntent('/STOP')).toBe('stop'));
});
```

- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 实现**

```typescript
// packages/agent-runtime/src/intent.ts
export type Intent = 'stop' | 'correction' | 'continue';

export function classifyIntent(message: string): Intent {
  const normalized = message.trim().toLowerCase();
  const stopExact = ['/stop', '/cancel', '停止', '取消'];
  if (stopExact.includes(normalized)) return 'stop';
  const correctionExact = ['/retry', '/redo', '重来', '重试'];
  if (correctionExact.includes(normalized)) return 'correction';
  return 'continue';
}
```

- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/intent.ts packages/agent-runtime/src/intent.test.ts
git commit -m "feat(agent-runtime): add intent classification (stop/correction/continue)"
```

---

### Task 8: 工具格式转换（Function Call / CLI 双模式）

**Files:**
- Create: `packages/agent-runtime/src/tool-format.ts`
- Test: `packages/agent-runtime/src/tool-format.test.ts`

- [ ] **Step 1: 写测试**

测试覆盖：
- `toCLIFormat()`: 将 ToolDefinition[] 转为 CLI 格式字符串
- `parseToolCallsFromText()`: 从文本解析 XML 格式工具调用
- `parseToolCallsFromText()`: 从文本解析 JSON block 格式工具调用
- `parseToolCallsFromText()`: 无匹配返回空数组

- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 实现 tool-format.ts**

包含：
- `toCLIFormat(tools)`: 一行一个工具的简洁 CLI 格式 + `<tool>` XML 使用说明
- `parseToolCallsFromText(text)`: 双路径解析（XML regex + JSON block regex），返回 `LLMToolCall[]`

- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/tool-format.ts packages/agent-runtime/src/tool-format.test.ts
git commit -m "feat(agent-runtime): add tool format conversion (Function Call / CLI dual mode)"
```

---

### Task 9: protocol.ts 扩充流式事件类型

**Files:**
- Modify: `packages/agent-runtime/src/protocol.ts`

- [ ] **Step 1: 重写 protocol.ts**

用 `llm/types.ts` 中的 `LLMStreamEvent` 和 `AgentStreamEvent` 替代原有 `AgentResponse`。保留 `AgentRequest`、`RunnerMessage`、`ServerMessage`，更新 `AgentResponse` 为 `AgentStreamEvent`。

- [ ] **Step 2: 运行 typecheck 验证无报错**

Run: `cd packages/agent-runtime && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime/src/protocol.ts
git commit -m "refactor(agent-runtime): expand protocol with 12 stream event types"
```

---

### Task 10: ToolRegistry 增加受限模式

**Files:**
- Modify: `packages/agent-runtime/src/tool-registry.ts`
- Test: `packages/agent-runtime/src/tool-registry.test.ts` (追加测试)

- [ ] **Step 1: 追加受限模式测试**

```typescript
// 追加到 tool-registry.test.ts
describe('restricted mode', () => {
  it('blocks non-allowed tools in restricted mode', async () => {
    registry.register('bash', { ... });
    registry.register('memory_write', { ... });
    registry.enterRestrictedMode(['memory_write']);
    const result = await registry.execute('bash', { command: 'ls' });
    expect(result).toContain('not available during context consolidation');
  });

  it('allows listed tools in restricted mode', async () => {
    registry.enterRestrictedMode(['memory_write']);
    const result = await registry.execute('memory_write', { name: 'test', type: 'log', content: 'hi' });
    expect(result).not.toContain('not available');
  });

  it('exitRestrictedMode restores all tools', async () => {
    registry.enterRestrictedMode(['memory_write']);
    registry.exitRestrictedMode();
    // bash should work again
  });
});
```

- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 实现受限模式**

在 `ToolRegistry` 类中添加 `restrictedTools` 字段 + `enterRestrictedMode` / `exitRestrictedMode` 方法 + `execute` 入口检查。

- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/tool-registry.ts packages/agent-runtime/src/tool-registry.test.ts
git commit -m "feat(agent-runtime): add ToolRegistry restricted mode for PreCompact"
```

---

### Task 11: Agent Loop 重构 — 接入 LLMProvider

**Files:**
- Modify: `packages/agent-runtime/src/agent.ts`
- Test: `packages/agent-runtime/src/agent.test.ts` (如有，更新)

- [ ] **Step 1: 重构 agent.ts**

关键变更：
- `AgentDeps` 中 `llmClient: LLMClient` 替换为 `provider: LLMProvider`
- Agent Loop 改用 `provider.stream()` 替代 `llmClient.chat()`
- 增加 `classifyIntent()` 在入口处
- 增加 capabilities 感知（toolUse/vision/thinking）
- 工具定义根据 `caps.toolUse` 走 Function Call 或 CLI 模式
- CLI 模式时从 assistant 文本中 `parseToolCallsFromText()`
- 流式事件通过回调转发（区分 LLM 层和 Agent 层事件）
- 整合后调用 `toolRegistry.enterRestrictedMode` / `exitRestrictedMode`

- [ ] **Step 2: 运行 typecheck**

Run: `cd packages/agent-runtime && npx tsc --noEmit`

- [ ] **Step 3: 运行全部测试**

Run: `cd packages/agent-runtime && npx vitest run`
Expected: 部分测试可能需要适配新接口

- [ ] **Step 4: 修复失败的测试**
- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/agent.ts
git commit -m "refactor(agent-runtime): Agent Loop uses LLMProvider interface, adds intent + capabilities"
```

---

### Task 12: index.ts 适配 + 删除 llm-client.ts

**Files:**
- Modify: `packages/agent-runtime/src/index.ts`
- Delete: `packages/agent-runtime/src/llm-client.ts`
- Delete: `packages/agent-runtime/src/llm-client.test.ts`
- Modify: `packages/agent-runtime/src/consolidator.ts` (更新 import)
- Modify: `packages/agent-runtime/package.json` (删除 SDK 依赖)

- [ ] **Step 1: 更新 index.ts initModules()**

将 `new LLMClient(apiKey)` 替换为 `LLMProviderFactory.create(config)`。config 从 AgentRequest.context 中获取 provider 信息。

- [ ] **Step 2: 更新 consolidator.ts import**

将 `import { LLMResponse } from './llm-client.js'` 改为从 `./llm/types.js` 导入 `ChatResponse`。

- [ ] **Step 3: 删除旧文件**

```bash
rm packages/agent-runtime/src/llm-client.ts packages/agent-runtime/src/llm-client.test.ts
```

- [ ] **Step 4: 更新 package.json 依赖**

```diff
- "@anthropic-ai/claude-code": "^1.0.0",
```

- [ ] **Step 5: 运行全部测试**

Run: `cd packages/agent-runtime && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(agent-runtime): remove SDK deps, wire LLMProviderFactory in index.ts"
```

---

## Chunk 3: 上下文管理重构

### Task 13: Consolidator 重构 — 滑动窗口压缩

**Files:**
- Modify: `packages/agent-runtime/src/consolidator.ts`
- Modify: `packages/agent-runtime/src/consolidator.test.ts`

- [ ] **Step 1: 更新测试用例**

新增测试：
- 滑动压缩：未压缩 > 30% 时压缩 1 个轮次组
- 硬截断：总 token > 80% 时直接截断
- 多次滑动：连续调用只压 1 组
- Log 记忆合并：超 15 条或 4000 token 时触发合并

更新测试：
- 将 `CONSOLIDATION_THRESHOLD_RATIO = 0.5` 相关断言改为 0.3
- 将 `TARGET_RATIO = 0.3` 相关断言移除（滑动模式无 target）

- [ ] **Step 2: 运行测试验证失败**
- [ ] **Step 3: 重构 consolidator.ts**

关键变更：
- `maybeConsolidate()` → 滑动模式：检查未压缩 > 30%？压 1 组
- 新增 `hardTruncate()` → 总 > 80%？直接截断
- 新增 `maybeConsolidateLogs()` → session log > 15 条或 4000 token？合并
- `contextWindow` 从 `provider.capabilities().contextWindow` 获取

- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/consolidator.ts packages/agent-runtime/src/consolidator.test.ts
git commit -m "refactor(agent-runtime): sliding window compression + hard truncation + log merge"
```

---

### Task 14: ContextAssembler capabilities 感知

**Files:**
- Modify: `packages/agent-runtime/src/context-assembler.ts`
- Modify: `packages/agent-runtime/src/context-assembler.test.ts`

- [ ] **Step 1: 追加测试**

- 当 `caps.toolUse=false` 时，工具定义不出现在 toolDefinitions 中（留给 agent.ts 注入 prompt）
- 当 `caps.vision=false` 时，历史消息中图片被移除
- `contextWindow` 从 capabilities 获取

- [ ] **Step 2: 实现**

`assemble()` 方法增加 `capabilities` 参数，步骤 5-6 根据 `toolUse` 决定是否返回工具定义。

- [ ] **Step 3: 运行测试通过**
- [ ] **Step 4: Commit**

```bash
git add packages/agent-runtime/src/context-assembler.ts packages/agent-runtime/src/context-assembler.test.ts
git commit -m "feat(agent-runtime): ContextAssembler capabilities-aware assembly"
```

---

## Chunk 4: MCP 补齐 + Skill 增强

### Task 15: MCP Transport 实现

**Files:**
- Create: `packages/agent-runtime/src/mcp-transport.ts`
- Test: `packages/agent-runtime/src/mcp-transport.test.ts`

- [ ] **Step 1: 写 StdioTransport 测试**

测试覆盖：
- 发送 JSON-RPC 请求并接收响应
- 请求 id 匹配
- 超时处理

- [ ] **Step 2: 实现 StdioTransport + SSETransport + StreamableHttpTransport**

- [ ] **Step 3: 测试通过 + Commit**

```bash
git add packages/agent-runtime/src/mcp-transport.ts packages/agent-runtime/src/mcp-transport.test.ts
git commit -m "feat(agent-runtime): MCP transport layer (stdio/sse/streamable-http)"
```

---

### Task 16: MCP Manager 补齐

**Files:**
- Modify: `packages/agent-runtime/src/mcp-manager.ts`
- Modify: `packages/agent-runtime/src/mcp-manager.test.ts`

- [ ] **Step 1: 补齐 discoverTools() 和工具执行**

将 `discoverTools()` 中的空数组替换为通过 `MCPTransport.send()` 调用 `tools/list` JSON-RPC 方法。工具执行调用 `tools/call`。

- [ ] **Step 2: 测试通过 + Commit**

```bash
git add packages/agent-runtime/src/mcp-manager.ts packages/agent-runtime/src/mcp-manager.test.ts
git commit -m "feat(agent-runtime): complete MCP manager with JSON-RPC protocol"
```

---

### Task 17: Skill 版本管理 + 市场源接口

**Files:**
- Modify: `packages/agent-runtime/src/skill-loader.ts`
- Create: `packages/agent-runtime/src/skill-source.ts`
- Test: `packages/agent-runtime/src/skill-source.test.ts`

- [ ] **Step 1: 创建 SkillSource 接口和 GitHubSource 实现**

```typescript
// packages/agent-runtime/src/skill-source.ts
export interface SkillListing {
  name: string;
  description: string;
  version: string;
  author: string;
  downloadUrl: string;
}

export interface SkillSource {
  search(query: string, page?: number): Promise<SkillListing[]>;
  download(id: string, targetDir: string): Promise<void>;
}
```

- [ ] **Step 2: SkillLoader 增加版本字段支持**

在 `LoadedSkill` 接口中增加 `version`、`sourceUrl`、`latestVersion` 可选字段。

- [ ] **Step 3: 测试通过 + Commit**

```bash
git add packages/agent-runtime/src/skill-source.ts packages/agent-runtime/src/skill-source.test.ts packages/agent-runtime/src/skill-loader.ts
git commit -m "feat(agent-runtime): skill marketplace source interface + version management"
```

---

## Chunk 5: Server 侧 OAuth + DB 变更

### Task 18: DB Schema 扩展（providers + oauth_states）

**Files:**
- Modify: `packages/server/src/db/schema.sqlite.ts`
- Modify: `packages/server/src/db/schema.pg.ts`
- Modify: `packages/server/src/db/schema.mysql.ts`

- [ ] **Step 1: 三方言 schema 增加 oauth_state 字段和 oauth_states 表**

providers 表增加 `oauthState` text 字段。
新增 `oauthStates` 表（state PK, userId, type, codeVerifier, expiresAt, createdAt）。

- [ ] **Step 2: 生成迁移**

Run: `cd packages/server && npx drizzle-kit generate`

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/ packages/server/db/migrations/
git commit -m "feat(server): extend providers schema + add oauth_states table"
```

---

### Task 19: OAuth 路由 + Token Manager

**Files:**
- Create: `packages/server/src/api/oauth.ts`
- Create: `packages/server/src/core/oauth-token-manager.ts`
- Modify: `packages/server/src/api/providers.ts`
- Test: `packages/server/src/api/oauth.test.ts`

- [ ] **Step 1: 实现 OAuthTokenManager**

```typescript
// packages/server/src/core/oauth-token-manager.ts
// - getToken(provider): 获取有效 token，过期自动刷新
// - refresh(type, refreshToken): 调用各家 token 端点
// - OAUTH_ENDPOINTS 配置（带 status: pending/available 标记）
```

- [ ] **Step 2: 实现 OAuth 路由**

```typescript
// packages/server/src/api/oauth.ts
// - GET /:type/authorize → 生成 state + PKCE，302 跳转
// - GET /:type/callback → 验证 state，换 token，存 DB
```

- [ ] **Step 3: 更新 providers.ts**

Provider 创建/更新时支持 `authType: 'oauth'`，展示 OAuth 状态。

- [ ] **Step 4: 写测试**

测试 state 生成、callback 验证、token 刷新逻辑。

- [ ] **Step 5: 测试通过 + Commit**

```bash
git add packages/server/src/api/oauth.ts packages/server/src/core/oauth-token-manager.ts packages/server/src/api/providers.ts packages/server/src/api/oauth.test.ts
git commit -m "feat(server): OAuth authorization flow + token auto-refresh"
```

---

### Task 20: Server 入口集成 OAuth 路由

**Files:**
- Modify: `packages/server/src/index.ts` (或 app 入口)

- [ ] **Step 1: 注册 OAuth 路由**

```typescript
import { oauthRouter } from './api/oauth.js';
app.route('/api/oauth', oauthRouter);
```

- [ ] **Step 2: 更新 AgentRequest 传递 Provider 配置**

Server 在 dispatch AgentRequest 时，解析 Provider（API Key 解密 / OAuth getToken），将凭证和 provider type 注入 request。

- [ ] **Step 3: 全量 typecheck + 测试**

Run: `cd packages/server && npx tsc --noEmit && npx vitest run`
Run: `cd packages/agent-runtime && npx tsc --noEmit && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/
git commit -m "feat(server): integrate OAuth routes + pass provider config to Runner"
```

---

## Chunk 6: 全链路集成验证

### Task 21: 全量 Typecheck + 测试

**Files:** 全部

- [ ] **Step 1: 4 包 typecheck**

```bash
cd packages/shared && npx tsc --noEmit
cd packages/server && npx tsc --noEmit
cd packages/agent-runtime && npx tsc --noEmit
cd packages/web && npx tsc --noEmit
```

- [ ] **Step 2: 全量测试**

```bash
cd packages/agent-runtime && npx vitest run
cd packages/server && npx vitest run
cd packages/shared && npx vitest run
```

Expected: ALL PASS

- [ ] **Step 3: 修复任何失败**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: full integration verification — typecheck + all tests passing"
```

---

## 依赖关系

```
Task 1 (types) → Task 2 (base) → Task 3 (anthropic) → Task 6 (factory)
                                → Task 4 (openai)    → Task 6 (factory)
                                → Task 5 (gemini)    → Task 6 (factory)
Task 7 (intent)     ─── 独立 ───
Task 8 (tool-format) ─── 独立 ───
Task 9 (protocol)   ─── 独立 ───
Task 10 (registry)  ─── 独立 ───
Task 6 + 7 + 8 + 9 + 10 → Task 11 (agent loop) → Task 12 (index.ts + cleanup)
Task 12 → Task 13 (consolidator) → Task 14 (assembler)
Task 15 (transport) → Task 16 (mcp manager)
Task 17 (skill) ─── 独立 ───
Task 18 (db) → Task 19 (oauth) → Task 20 (server integration)
Task 12 + 14 + 16 + 17 + 20 → Task 21 (full verification)
```

**可并行的 Task 组**：
- Group A: Task 3 + 4 + 5（三个 adapter 可并行）
- Group B: Task 7 + 8 + 9 + 10（四个独立模块可并行）
- Group C: Task 15 + 17 + 18（MCP、Skill、DB 可并行）
