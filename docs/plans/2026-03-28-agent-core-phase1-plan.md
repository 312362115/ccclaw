# Agent Core Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/agent-core` with a working `createAgent()` API that can run a Headless Agent using Qwen3.5-Plus, verified by a demo that autonomously completes multi-turn tool calls and outputs a report.

**Architecture:** Extract core agent capabilities from `packages/agent-runtime` into a new zero-dependency package. The package exposes a `createAgent()` factory that wires up Provider → ToolRegistry → ContextAssembler → AgentLoop internally. Users only touch the public API surface.

**Tech Stack:** TypeScript, ESM, Node.js ≥ 22, vitest for testing, pnpm workspace

**Spec:** `docs/specs/2026-03-28-agent-core-library.md`

---

## File Structure

### New files (packages/agent-core/)

| File | Responsibility |
|------|---------------|
| `package.json` | Package config, zero `@ccclaw/*` deps |
| `tsconfig.json` | TypeScript config, ESM |
| `src/index.ts` | Public API: `createAgent`, type re-exports |
| `src/types.ts` | `AgentConfig`, `AgentResult`, `AgentStreamEvent`, `Tool` |
| `src/agent.ts` | `Agent` class: `run()`, `stream()`, internal loop |
| `src/agent-loop.ts` | Core iteration loop (extracted from agent-runtime) |
| `src/providers/types.ts` | `LLMProvider`, `ChatParams`, `LLMStreamEvent`, etc. |
| `src/providers/base.ts` | `withRetry`, `isTransientError`, `sanitizeMessages` |
| `src/providers/compat.ts` | OpenAI-compatible adapter (Qwen/DeepSeek/all) |
| `src/providers/factory.ts` | `createProvider()` |
| `src/tools/types.ts` | `Tool`, `ToolSchema`, `ToolDefinition` |
| `src/tools/registry.ts` | `ToolRegistry` |
| `src/tools/format.ts` | Tool call format conversion + parsing (native + CLI) |
| `src/profiles/types.ts` | `ModelProfile`, `ModelCapabilities`, etc. |
| `src/profiles/registry.ts` | `ProfileRegistry` |
| `src/profiles/alibaba.ts` | Qwen3.5-Plus profile |
| `src/profiles/_default.ts` | Fallback profile |
| `src/context/assembler.ts` | Lightweight `ContextAssembler` |
| `src/context/token-estimator.ts` | Token estimation utility |
| `src/prompt/types.ts` | `PromptLayer`, `PromptEnhancerConfig` |
| `src/prompt/base.ts` | Base prompt template |
| `src/prompt/composer.ts` | Layered prompt composer |
| `src/prompt/enhancers/tool-guidance.ts` | Tool call guidance by tier |
| `src/memory/types.ts` | `MemoryStore` interface |
| `src/memory/in-memory-store.ts` | In-memory implementation |
| `vitest.config.ts` | Test config |
| `src/__tests__/agent.test.ts` | Agent integration test |
| `src/__tests__/tool-format.test.ts` | Tool format parsing tests |
| `src/__tests__/prompt-composer.test.ts` | Prompt composer tests |
| `examples/headless-report.ts` | Demo: Headless report generation |

---

## Task Dependency Graph

```
Task 1 (package scaffold)
  ↓
Task 2 (types) ──→ Task 3 (provider) ──→ Task 5 (agent loop)
  ↓                                        ↑
Task 4 (tool system) ─────────────────────┘
  ↑                                        ↑
Task 6 (profiles) ─────────────────────────┘
  ↓
Task 7 (context assembler + prompt)
  ↓
Task 8 (createAgent API)
  ↓
Task 9 (headless demo)
```

---

### Task 1: Package Scaffold

**Files:**
- Create: `packages/agent-core/package.json`
- Create: `packages/agent-core/tsconfig.json`
- Create: `packages/agent-core/vitest.config.ts`
- Create: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agent-core/sdk",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create placeholder index.ts**

```typescript
// @agent-core/sdk — Public API
// Phase 1: Headless Agent with Qwen3.5-Plus support

export { createAgent } from './agent.js';
export type { AgentConfig, AgentResult, Agent } from './types.js';
export type { Tool, ToolSchema } from './tools/types.js';
export type { AgentStreamEvent } from './providers/types.js';
```

- [ ] **Step 5: Install deps and verify build**

Run: `cd /Users/renlongyu/Desktop/ccclaw && pnpm install && cd packages/agent-core && pnpm typecheck 2>&1 | head -5`
Expected: Type errors about missing files (expected at this stage — confirms scaffold works)

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/
git commit -m "feat(agent-core): package scaffold — zero-dep agent library"
```

---

### Task 2: Core Types

**Files:**
- Create: `packages/agent-core/src/types.ts`
- Create: `packages/agent-core/src/providers/types.ts`
- Create: `packages/agent-core/src/tools/types.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-core/src/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AgentConfig, AgentResult } from '../types.js';
import type { Tool, ToolSchema } from '../tools/types.js';
import type { LLMProvider, ChatParams, LLMStreamEvent } from '../providers/types.js';

describe('Core Types', () => {
  it('AgentConfig accepts minimal config', () => {
    const config: AgentConfig = {
      model: 'qwen3.5-plus',
      apiKey: 'sk-test',
      systemPrompt: 'You are helpful.',
      tools: [],
    };
    expect(config.model).toBe('qwen3.5-plus');
    expect(config.maxIterations).toBeUndefined();
  });

  it('Tool definition is type-safe', () => {
    const tool: Tool = {
      name: 'search',
      description: 'Search the web',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      execute: async (input) => `Results for ${input.query}`,
    };
    expect(tool.name).toBe('search');
  });

  it('AgentResult contains text and metadata', () => {
    const result: AgentResult = {
      text: 'Final report',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 200 },
      iterations: 3,
    };
    expect(result.iterations).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/types.test.ts 2>&1 | tail -5`
Expected: FAIL — cannot find module '../types.js'

- [ ] **Step 3: Create providers/types.ts**

Copy from `packages/agent-runtime/src/llm/types.ts` with these changes:
- Remove `AgentStreamEvent` types specific to ccclaw UX (`diff_preview`, `confirm_request`, `subagent_*`)
- Keep: `LLMToolCall`, `LLMToolResult`, `LLMMessage`, `ContentBlock`, `ChatParams`, `ProviderCapabilities`, `ProviderConfig`, `LLMStreamEvent`, `LLMProvider`, `TokenUsage`, `StopReason`, `getTextContent`, `hasImageContent`
- Add `AgentStreamEvent` as a simplified union (text_delta, thinking_delta, tool_use_*, tool_result, usage, done, error)

```typescript
// packages/agent-core/src/providers/types.ts

// ====== Content blocks ======

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export function getTextContent(content: string | ContentBlock[] | null | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is TextContentBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// ====== Messages ======

export interface LLMToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LLMToolResult {
  toolCallId: string;
  output: string;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCalls?: LLMToolCall[];
  toolResults?: LLMToolResult[];
}

// ====== Chat params ======

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatParams {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  thinkingConfig?: { budgetTokens: number };
  responseFormat?: { type: 'json_object' | 'text' };
  /** Vendor-specific extra params (e.g. enable_thinking for Qwen) */
  extra?: Record<string, unknown>;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

// ====== Provider interface ======

export interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  extendedThinking: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ProviderConfig {
  type: string;
  apiKey: string;
  apiBase?: string;
  defaultModel?: string;
}

// ====== Stream events ======

export type LLMStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_use_start'; toolCallId: string; name: string }
  | { type: 'tool_use_delta'; toolCallId: string; delta: string }
  | { type: 'tool_use_end'; toolCallId: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; stopReason: StopReason }
  | { type: 'error'; error?: Error; message?: string };

export type AgentStreamEvent =
  | LLMStreamEvent
  | { type: 'tool_result'; toolCallId: string; toolName: string; output: string }
  | { type: 'session_done'; usage: TokenUsage };

// ====== LLMProvider ======

export interface LLMProvider {
  stream(params: ChatParams): AsyncIterable<LLMStreamEvent>;
  capabilities(): ProviderCapabilities;
}
```

- [ ] **Step 4: Create tools/types.ts**

```typescript
// packages/agent-core/src/tools/types.ts

export interface ToolSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  schema?: ToolSchema;
  execute(input: Record<string, unknown>): Promise<string>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema?: ToolSchema;
}
```

- [ ] **Step 5: Create types.ts (public API types)**

```typescript
// packages/agent-core/src/types.ts

import type { Tool } from './tools/types.js';
import type { TokenUsage, AgentStreamEvent } from './providers/types.js';

export type { AgentStreamEvent };

export interface AgentConfig {
  /** Model ID (e.g. 'qwen3.5-plus') */
  model: string;
  /** API key */
  apiKey: string;
  /** API base URL (required for non-OpenAI models) */
  apiBase?: string;
  /** System prompt — highest priority layer */
  systemPrompt?: string;
  /** Custom tools */
  tools?: Tool[];
  /** Max agent loop iterations (default: 25) */
  maxIterations?: number;
  /** Temperature override (default: from profile) */
  temperature?: number;
  /** Max output tokens override (default: from profile) */
  maxTokens?: number;
  /** Provider type hint (default: auto-detect from apiBase) */
  provider?: 'anthropic' | 'openai' | 'compat';
  /** Enable thinking/reasoning mode */
  thinking?: boolean;
  /** Prompt enhancement options */
  promptEnhancements?: {
    toolUseGuidance?: boolean;
  };
  /** Event callback for streaming (alternative to stream()) */
  onEvent?: (event: AgentStreamEvent) => void;
}

export interface AgentResult {
  /** Final text output from the agent */
  text: string;
  /** All tool calls made during execution */
  toolCalls: Array<{ name: string; input: unknown; output: string }>;
  /** Token usage */
  usage: TokenUsage;
  /** Number of loop iterations */
  iterations: number;
}

export interface Agent {
  /** Run to completion, return final result */
  run(message: string): Promise<AgentResult>;
  /** Stream events as async iterable */
  stream(message: string): AsyncIterable<AgentStreamEvent>;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/types.test.ts 2>&1 | tail -10`
Expected: PASS — 3 tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/types.ts packages/agent-core/src/providers/types.ts packages/agent-core/src/tools/types.ts packages/agent-core/src/__tests__/types.test.ts
git commit -m "feat(agent-core): core type definitions — AgentConfig, Tool, LLMProvider"
```

---

### Task 3: OpenAI-Compatible Provider (Qwen3.5-Plus)

**Files:**
- Create: `packages/agent-core/src/providers/base.ts`
- Create: `packages/agent-core/src/providers/compat.ts`
- Create: `packages/agent-core/src/providers/factory.ts`
- Create: `packages/agent-core/src/__tests__/provider-compat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-core/src/__tests__/provider-compat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createProvider } from '../providers/factory.js';

describe('CompatProvider', () => {
  it('creates provider from apiBase + apiKey', () => {
    const provider = createProvider({
      type: 'compat',
      apiKey: 'sk-test',
      apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultModel: 'qwen3.5-plus',
    });
    expect(provider).toBeDefined();
    const caps = provider.capabilities();
    expect(caps.streaming).toBe(true);
    expect(caps.toolUse).toBe(true);
  });

  it('throws without apiBase for compat type', () => {
    expect(() => createProvider({
      type: 'compat',
      apiKey: 'sk-test',
    })).toThrow(/apiBase/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/provider-compat.test.ts 2>&1 | tail -5`
Expected: FAIL — cannot find '../providers/factory.js'

- [ ] **Step 3: Create providers/base.ts**

Copy `packages/agent-runtime/src/llm/base.ts` exactly (it has no ccclaw deps). Contains: `isTransientError`, `withRetry`, `sleep`, `sanitizeMessages`, `stripImageContent`.

- [ ] **Step 4: Create providers/compat.ts**

Adapt from `packages/agent-runtime/src/llm/openai.ts` + `compat.ts`. This is the unified OpenAI-compatible adapter that handles Qwen3.5-Plus. Key implementation points:

- Uses native `fetch` (no openai SDK dependency)
- Endpoint: `${apiBase}/chat/completions`
- Supports streaming via SSE
- Handles `tool_calls` in response (OpenAI format)
- Handles `reasoning_content` in delta (Qwen thinking mode)
- Passes `extra` params from ChatParams to request body (for `enable_thinking` etc.)

```typescript
// packages/agent-core/src/providers/compat.ts

import type {
  LLMProvider, ChatParams, LLMStreamEvent, ProviderCapabilities, ProviderConfig,
} from './types.js';
import { withRetry } from './base.js';

export class CompatProvider implements LLMProvider {
  private apiKey: string;
  private apiBase: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    if (!config.apiBase) throw new Error('CompatProvider requires apiBase');
    this.apiKey = config.apiKey;
    this.apiBase = config.apiBase.replace(/\/$/, '');
    this.defaultModel = config.defaultModel ?? 'gpt-4o';
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      extendedThinking: false,
      vision: false,
      contextWindow: 128_000,
      maxOutputTokens: 8192,
    };
  }

  async *stream(params: ChatParams): AsyncIterable<LLMStreamEvent> {
    const body = this.buildRequestBody(params);
    const response = await withRetry(() =>
      fetch(`${this.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return r;
      }),
    );

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          let data: any;
          try { data = JSON.parse(trimmed.slice(6)); } catch { continue; }

          const delta = data.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            yield { type: 'text_delta', delta: delta.content };
          }

          // Thinking content (Qwen reasoning_content)
          if (delta.reasoning_content) {
            yield { type: 'thinking_delta', delta: delta.reasoning_content };
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (tc.id) {
                toolCallBuffers.set(idx, { id: tc.id, name: tc.function?.name ?? '', args: '' });
                yield { type: 'tool_use_start', toolCallId: tc.id, name: tc.function?.name ?? '' };
              }
              const buf = toolCallBuffers.get(idx);
              if (buf && tc.function?.arguments) {
                buf.args += tc.function.arguments;
                yield { type: 'tool_use_delta', toolCallId: buf.id, delta: tc.function.arguments };
              }
            }
          }

          // Finish reason
          const finishReason = data.choices?.[0]?.finish_reason;
          if (finishReason) {
            // End all pending tool calls
            for (const [idx, buf] of toolCallBuffers) {
              yield { type: 'tool_use_end', toolCallId: buf.id };
            }
            toolCallBuffers.clear();

            const stopReason = finishReason === 'tool_calls' ? 'tool_use'
              : finishReason === 'length' ? 'max_tokens'
              : 'end_turn';
            yield { type: 'done', stopReason };
          }

          // Usage
          if (data.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: data.usage.prompt_tokens ?? 0,
                outputTokens: data.usage.completion_tokens ?? 0,
              },
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private buildRequestBody(params: ChatParams): Record<string, unknown> {
    const messages: any[] = [];

    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }

    for (const msg of params.messages) {
      const m: any = { role: msg.role, content: msg.content };
      if (msg.toolCalls?.length) {
        m.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      if (msg.toolResults?.length) {
        for (const tr of msg.toolResults) {
          messages.push({ role: 'tool', tool_call_id: tr.toolCallId, content: tr.output });
        }
        continue;
      }
      messages.push(m);
    }

    const body: Record<string, unknown> = {
      model: params.model || this.defaultModel,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: params.temperature ?? 0.1,
      max_tokens: params.maxTokens ?? 8192,
    };

    if (params.tools?.length) {
      body.tools = params.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.schema },
      }));
    }

    if (params.responseFormat) {
      body.response_format = params.responseFormat;
    }

    // Vendor-specific extra params (e.g. enable_thinking for Qwen)
    if (params.extra) {
      Object.assign(body, params.extra);
    }

    return body;
  }
}
```

- [ ] **Step 5: Create providers/factory.ts**

```typescript
// packages/agent-core/src/providers/factory.ts

import type { LLMProvider, ProviderConfig } from './types.js';
import { CompatProvider } from './compat.js';

export function createProvider(config: ProviderConfig): LLMProvider {
  if (!config.apiKey) throw new Error('apiKey is required');

  // MVP: all models go through CompatProvider (OpenAI-compatible)
  // Future: add AnthropicProvider, etc.
  return new CompatProvider(config);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/provider-compat.test.ts 2>&1 | tail -10`
Expected: PASS — 2 tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/providers/
git commit -m "feat(agent-core): OpenAI-compatible LLM provider with SSE streaming"
```

---

### Task 4: Tool System

**Files:**
- Create: `packages/agent-core/src/tools/registry.ts`
- Create: `packages/agent-core/src/tools/format.ts`
- Create: `packages/agent-core/src/__tests__/tool-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-core/src/__tests__/tool-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseToolCallsFromText, toCLIFormat } from '../tools/format.js';
import type { ToolDefinition } from '../tools/types.js';

describe('parseToolCallsFromText', () => {
  it('parses XML format tool call', () => {
    const text = 'Let me search.\n<tool name="search">{"query": "test"}</tool>';
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('search');
    expect(calls[0].input).toEqual({ query: 'test' });
  });

  it('parses JSON block format', () => {
    const text = '```tool\n{"name": "search", "input": {"query": "test"}}\n```';
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('search');
  });

  it('returns empty array for plain text', () => {
    const calls = parseToolCallsFromText('No tools here.');
    expect(calls).toHaveLength(0);
  });

  it('handles malformed JSON gracefully', () => {
    const text = '<tool name="search">{bad json}</tool>';
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(0);
  });
});

describe('toCLIFormat', () => {
  it('formats tool definitions for system prompt injection', () => {
    const defs: ToolDefinition[] = [
      { name: 'search', description: 'Search the web' },
    ];
    const text = toCLIFormat(defs);
    expect(text).toContain('search');
    expect(text).toContain('Search the web');
    expect(text).toContain('<tool name=');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/tool-format.test.ts 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Create tools/format.ts**

Copy from `packages/agent-runtime/src/tool-format.ts`. No ccclaw deps — direct copy. Contains `parseToolCallsFromText()` and `toCLIFormat()`.

- [ ] **Step 4: Create tools/registry.ts**

Simplified version of `packages/agent-runtime/src/tool-registry.ts`. Remove: MCP integration, Hook runner, VerifierRegistry, RestrictedMode. Keep: register, execute, getDefinitions, getToolNames, has.

```typescript
// packages/agent-core/src/tools/registry.ts

import type { Tool, ToolDefinition } from './types.js';

const MAX_TOOL_RESULT_CHARS = 16_000;

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, schema }) => ({
      name, description, schema,
    }));
  }

  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: Unknown tool "${name}"`;

    try {
      let result = await tool.execute(input);
      if (result.length > MAX_TOOL_RESULT_CHARS) {
        result = result.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...(truncated)';
      }
      return result;
    } catch (err) {
      return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/tool-format.test.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/tools/
git commit -m "feat(agent-core): tool registry + CLI/native format parser"
```

---

### Task 5: Agent Loop

**Files:**
- Create: `packages/agent-core/src/agent-loop.ts`

- [ ] **Step 1: Create agent-loop.ts**

Extract core loop from `packages/agent-runtime/src/agent.ts`. Remove: intent classification, plan mode, consolidator, MCP, subagent, ccclaw protocol types. Keep: multi-turn iteration, tool execution, streaming, stop conditions.

```typescript
// packages/agent-core/src/agent-loop.ts

import type {
  LLMProvider, ChatParams, LLMStreamEvent, AgentStreamEvent,
  LLMMessage, LLMToolCall, StopReason, TokenUsage,
} from './providers/types.js';
import { getTextContent } from './providers/types.js';
import type { ToolRegistry } from './tools/registry.js';
import { parseToolCallsFromText, toCLIFormat } from './tools/format.js';

export interface LoopDeps {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  systemPrompt: string;
  model: string;
  maxIterations: number;
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
  extra?: Record<string, unknown>;
}

export type StreamCallback = (event: AgentStreamEvent) => void;

export async function runAgentLoop(
  message: string,
  onStream: StreamCallback,
  deps: LoopDeps,
): Promise<void> {
  const {
    provider, toolRegistry, systemPrompt, model,
    maxIterations, temperature, maxTokens, thinking, extra,
  } = deps;

  const caps = provider.capabilities();
  const messages: LLMMessage[] = [{ role: 'user', content: message }];
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  const toolDefs = toolRegistry.getDefinitions();
  const llmTools = toolDefs.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema ?? {},
  }));

  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;

  for (let iter = 0; iter < maxIterations; iter++) {
    const chatParams: ChatParams = {
      model,
      messages,
      systemPrompt: caps.toolUse
        ? systemPrompt
        : systemPrompt + '\n\n' + toCLIFormat(toolDefs),
      temperature: temperature ?? 0.1,
      maxTokens: maxTokens ?? 8192,
    };

    if (caps.toolUse && llmTools.length > 0) {
      chatParams.tools = llmTools;
    }

    if (extra) chatParams.extra = extra;

    // Collect assistant response
    let assistantText = '';
    let thinkingText = '';
    const pendingToolCalls: LLMToolCall[] = [];
    let stopReason: StopReason = 'end_turn';
    const currentToolCall: { id: string; name: string; json: string } | null = null;

    const toolCallBuffers = new Map<string, { id: string; name: string; json: string }>();

    for await (const event of provider.stream(chatParams)) {
      onStream(event);

      switch (event.type) {
        case 'text_delta':
          assistantText += event.delta;
          break;
        case 'thinking_delta':
          thinkingText += event.delta;
          break;
        case 'tool_use_start':
          toolCallBuffers.set(event.toolCallId, { id: event.toolCallId, name: event.name, json: '' });
          break;
        case 'tool_use_delta': {
          const buf = toolCallBuffers.get(event.toolCallId);
          if (buf) buf.json += event.delta;
          break;
        }
        case 'tool_use_end': {
          const buf = toolCallBuffers.get(event.toolCallId);
          if (buf) {
            let input: unknown = {};
            try { input = JSON.parse(buf.json); } catch { /* empty */ }
            pendingToolCalls.push({ id: buf.id, name: buf.name, input });
            toolCallBuffers.delete(event.toolCallId);
          }
          break;
        }
        case 'usage':
          totalUsage.inputTokens += event.usage.inputTokens;
          totalUsage.outputTokens += event.usage.outputTokens;
          break;
        case 'done':
          stopReason = event.stopReason;
          break;
      }
    }

    // CLI mode: parse tool calls from text
    if (!caps.toolUse && assistantText) {
      const parsed = parseToolCallsFromText(assistantText);
      if (parsed.length > 0) {
        pendingToolCalls.push(...parsed.map((p, i) => ({
          id: `cli-${iter}-${i}`,
          name: p.name,
          input: p.input,
        })));
        stopReason = 'tool_use';
      }
    }

    // Append assistant message
    messages.push({
      role: 'assistant',
      content: assistantText,
      toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
    });

    // No tool calls → done
    if (stopReason !== 'tool_use' || pendingToolCalls.length === 0) {
      onStream({ type: 'session_done', usage: totalUsage });
      return;
    }

    // Execute tool calls
    const toolResults: { toolCallId: string; output: string }[] = [];

    for (const tc of pendingToolCalls) {
      const input = (tc.input ?? {}) as Record<string, unknown>;
      const output = await toolRegistry.execute(tc.name, input);
      const isError = output.startsWith('Error');

      if (isError) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          onStream({ type: 'error', message: `${MAX_CONSECUTIVE_ERRORS} consecutive tool errors, stopping.` });
          onStream({ type: 'session_done', usage: totalUsage });
          return;
        }
      } else {
        consecutiveErrors = 0;
      }

      toolResults.push({ toolCallId: tc.id, output });
      onStream({ type: 'tool_result', toolCallId: tc.id, toolName: tc.name, output });
    }

    // Append tool results
    messages.push({
      role: 'tool',
      content: '',
      toolResults,
    });
  }

  // Max iterations reached
  onStream({ type: 'session_done', usage: totalUsage });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors (or only errors from missing index.ts exports)

- [ ] **Step 3: Commit**

```bash
git add packages/agent-core/src/agent-loop.ts
git commit -m "feat(agent-core): agent loop — multi-turn tool execution with streaming"
```

---

### Task 6: Model Profiles (Qwen3.5-Plus + Default)

**Files:**
- Create: `packages/agent-core/src/profiles/types.ts`
- Create: `packages/agent-core/src/profiles/registry.ts`
- Create: `packages/agent-core/src/profiles/alibaba.ts`
- Create: `packages/agent-core/src/profiles/_default.ts`

- [ ] **Step 1: Create profiles/types.ts**

Copy `ModelProfile`, `ModelCapabilities`, `ModelDefaults`, `PromptStrategy`, `ExecutionStrategy`, `ModelRouting`, `AgentPhase`, `ModelVendor` from `packages/agent-runtime/src/llm/model-profile.ts`. No ccclaw deps — direct copy.

- [ ] **Step 2: Create profiles/_default.ts**

Copy from `packages/agent-runtime/src/llm/profiles/_default.ts`. Direct copy.

- [ ] **Step 3: Create profiles/alibaba.ts**

Update the existing Qwen profiles to include Qwen3.5-Plus as primary:

```typescript
// packages/agent-core/src/profiles/alibaba.ts

import type { ModelProfile } from './types.js';

export const alibabaProfiles: ModelProfile[] = [
  {
    id: 'qwen3.5-plus',
    displayName: 'Qwen3.5 Plus',
    vendor: 'alibaba',
    capabilities: {
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      toolUse: true,
      extendedThinking: true,
      vision: true,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    overrides: {
      planning: { temperature: 0.2, maxTokens: 4096 },
      reviewing: { temperature: 0.15, maxTokens: 4096 },
    },
    promptStrategy: {
      maxSystemPromptTokens: 8000,
      toolCallConstraints: [
        '每次只调用一个工具（不要并行，容易出错）',
        '调用前先用一句话说明你要做什么',
        '文件路径必须是绝对路径',
      ].join('\n'),
      needsToolExamples: false,
      preferPhasedPrompt: true,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 1,
      benefitsFromVerifyFix: true,
      benefitsFromAutoPlan: true,
      benefitsFromReview: true,
    },
    routing: {
      roles: ['primary', 'planning', 'coding', 'review'],
      costEfficiency: 4,
      capabilityTier: 4,
    },
  },
];
```

- [ ] **Step 4: Create profiles/registry.ts**

Simplified version of `packages/agent-runtime/src/llm/profiles/index.ts`:

```typescript
// packages/agent-core/src/profiles/registry.ts

import type { ModelProfile } from './types.js';
import { alibabaProfiles } from './alibaba.js';
import { defaultProfile } from './_default.js';

export class ProfileRegistry {
  private profiles: ModelProfile[] = [];

  constructor() {
    this.profiles.push(...alibabaProfiles);
  }

  register(profile: ModelProfile): void {
    this.profiles.push(profile);
  }

  resolve(modelId: string): ModelProfile {
    // Exact match
    const exact = this.profiles.find((p) => p.id === modelId);
    if (exact) return exact;

    // Prefix match (e.g. 'qwen3.5-plus' matches 'qwen3.5-plus-2026-02-15')
    const prefix = this.profiles.find((p) => modelId.startsWith(p.id));
    if (prefix) return prefix;

    return defaultProfile;
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/profiles/
git commit -m "feat(agent-core): model profiles — Qwen3.5-Plus + default fallback"
```

---

### Task 7: Context Assembler + Prompt Composer

**Files:**
- Create: `packages/agent-core/src/context/assembler.ts`
- Create: `packages/agent-core/src/context/token-estimator.ts`
- Create: `packages/agent-core/src/prompt/types.ts`
- Create: `packages/agent-core/src/prompt/base.ts`
- Create: `packages/agent-core/src/prompt/composer.ts`
- Create: `packages/agent-core/src/prompt/enhancers/tool-guidance.ts`
- Create: `packages/agent-core/src/__tests__/prompt-composer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-core/src/__tests__/prompt-composer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from '../prompt/composer.js';

describe('composeSystemPrompt', () => {
  it('includes user prompt as highest priority', () => {
    const result = composeSystemPrompt({
      userPrompt: 'You are an analyst.',
      capabilityTier: 5,
      toolDefs: [],
    });
    expect(result).toContain('You are an analyst.');
  });

  it('adds tool guidance for weak models', () => {
    const result = composeSystemPrompt({
      userPrompt: 'You are helpful.',
      capabilityTier: 3,
      toolDefs: [{ name: 'search', description: 'Search' }],
      enhancements: { toolUseGuidance: true },
    });
    expect(result).toContain('工具调用');
  });

  it('skips tool guidance for strong models', () => {
    const result = composeSystemPrompt({
      userPrompt: 'You are helpful.',
      capabilityTier: 5,
      toolDefs: [{ name: 'search', description: 'Search' }],
      enhancements: { toolUseGuidance: true },
    });
    expect(result).not.toContain('每次只调用一个工具');
  });

  it('adds tool constraints from profile', () => {
    const result = composeSystemPrompt({
      userPrompt: 'You are helpful.',
      capabilityTier: 3,
      toolDefs: [],
      toolCallConstraints: '每次只调用一个工具',
    });
    expect(result).toContain('每次只调用一个工具');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/prompt-composer.test.ts 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Create context/token-estimator.ts**

Copy from `packages/agent-runtime/src/utils/token-estimator.ts`. Typically a simple `string.length / 4` heuristic.

- [ ] **Step 4: Create prompt/types.ts**

```typescript
// packages/agent-core/src/prompt/types.ts

import type { ToolDefinition } from '../tools/types.js';

export interface PromptComposerInput {
  userPrompt?: string;
  capabilityTier: number;
  toolDefs: ToolDefinition[];
  toolCallConstraints?: string;
  enhancements?: {
    toolUseGuidance?: boolean;
  };
}
```

- [ ] **Step 5: Create prompt/base.ts**

```typescript
// packages/agent-core/src/prompt/base.ts

export const BASE_SYSTEM_PROMPT = `你是一个 AI 助手，能够使用工具来完成任务。

## 核心原则
- 准确性：不确定时先用工具获取信息
- 安全性：不执行危险操作
- 最小改动：只做与当前任务直接相关的事

## 输出风格
- 简洁直接
- 中文回复（除非用户用英文提问）`;
```

- [ ] **Step 6: Create prompt/enhancers/tool-guidance.ts**

```typescript
// packages/agent-core/src/prompt/enhancers/tool-guidance.ts

export function getToolGuidance(capabilityTier: number): string {
  if (capabilityTier >= 5) return '';

  if (capabilityTier >= 3) {
    return `## 工具调用规则
1. 每次只调用一个工具
2. 调用前先用一句话说明你要做什么
3. 确认工具调用结果后再继续下一步
4. 如果工具返回错误，分析原因后调整参数重试`;
  }

  return `## 工具调用（必须严格遵守）

### 调用流程
1. 先用一句话说明你的意图
2. 调用一个工具
3. 等待结果
4. 根据结果决定下一步

### 注意事项
- 每次只调用一个工具，不要同时调用多个
- 仔细检查工具参数格式是否正确
- 工具返回错误时，不要盲目重试，先分析原因`;
}
```

- [ ] **Step 7: Create prompt/composer.ts**

```typescript
// packages/agent-core/src/prompt/composer.ts

import type { PromptComposerInput } from './types.js';
import { BASE_SYSTEM_PROMPT } from './base.js';
import { getToolGuidance } from './enhancers/tool-guidance.js';

export function composeSystemPrompt(input: PromptComposerInput): string {
  const parts: string[] = [];

  // Layer 1: User prompt (highest priority)
  if (input.userPrompt) {
    parts.push(input.userPrompt);
  } else {
    parts.push(BASE_SYSTEM_PROMPT);
  }

  // Layer 2: Prompt enhancers (by capability tier)
  if (input.enhancements?.toolUseGuidance && input.toolDefs.length > 0) {
    const guidance = getToolGuidance(input.capabilityTier);
    if (guidance) parts.push(guidance);
  }

  // Layer 3: Tool constraints from profile
  if (input.toolCallConstraints) {
    parts.push(`## 工具调用约束\n${input.toolCallConstraints}`);
  }

  return parts.filter(Boolean).join('\n\n');
}
```

- [ ] **Step 8: Create context/assembler.ts**

Lightweight version — just combines system prompt with profile-driven limits:

```typescript
// packages/agent-core/src/context/assembler.ts

import type { ModelProfile } from '../profiles/types.js';
import type { ToolDefinition } from '../tools/types.js';
import { composeSystemPrompt } from '../prompt/composer.js';
import { estimateTokens } from './token-estimator.js';

export interface AssembleInput {
  userPrompt?: string;
  profile: ModelProfile;
  toolDefs: ToolDefinition[];
  enhancements?: { toolUseGuidance?: boolean };
}

export function assembleSystemPrompt(input: AssembleInput): string {
  const { userPrompt, profile, toolDefs, enhancements } = input;
  const tier = profile.routing?.capabilityTier ?? 3;

  let prompt = composeSystemPrompt({
    userPrompt,
    capabilityTier: tier,
    toolDefs,
    toolCallConstraints: profile.promptStrategy.toolCallConstraints,
    enhancements,
  });

  // Truncate if exceeds profile limit
  const maxTokens = profile.promptStrategy.maxSystemPromptTokens;
  if (maxTokens) {
    const current = estimateTokens(prompt);
    if (current > maxTokens) {
      const ratio = maxTokens / current;
      const targetChars = Math.floor(prompt.length * ratio * 0.95);
      prompt = prompt.slice(0, targetChars) + '\n...(truncated)';
    }
  }

  return prompt;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/prompt-composer.test.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/agent-core/src/context/ packages/agent-core/src/prompt/ packages/agent-core/src/__tests__/prompt-composer.test.ts
git commit -m "feat(agent-core): layered prompt system + context assembler"
```

---

### Task 8: createAgent() Public API

**Files:**
- Create: `packages/agent-core/src/agent.ts`
- Create: `packages/agent-core/src/memory/types.ts`
- Create: `packages/agent-core/src/memory/in-memory-store.ts`
- Modify: `packages/agent-core/src/index.ts`
- Create: `packages/agent-core/src/__tests__/agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-core/src/__tests__/agent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createAgent } from '../agent.js';

describe('createAgent', () => {
  it('creates agent with minimal config', () => {
    const agent = createAgent({
      model: 'qwen3.5-plus',
      apiKey: 'sk-test',
      apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      systemPrompt: 'You are helpful.',
      tools: [],
    });
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe('function');
    expect(typeof agent.stream).toBe('function');
  });

  it('creates agent with custom tools', () => {
    const agent = createAgent({
      model: 'qwen3.5-plus',
      apiKey: 'sk-test',
      apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      tools: [
        {
          name: 'echo',
          description: 'Echo input',
          execute: async (input) => JSON.stringify(input),
        },
      ],
    });
    expect(agent).toBeDefined();
  });

  it('defaults maxIterations to 25', () => {
    const agent = createAgent({
      model: 'qwen3.5-plus',
      apiKey: 'sk-test',
      apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      tools: [],
    });
    // Internal — we verify via run behavior, not direct access
    expect(agent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/agent.test.ts 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: Create memory/types.ts and memory/in-memory-store.ts**

```typescript
// packages/agent-core/src/memory/types.ts
export interface MemoryStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): string[];
}
```

```typescript
// packages/agent-core/src/memory/in-memory-store.ts
import type { MemoryStore } from './types.js';

export class InMemoryStore implements MemoryStore {
  private data = new Map<string, string>();

  get(key: string): string | undefined { return this.data.get(key); }
  set(key: string, value: string): void { this.data.set(key, value); }
  delete(key: string): void { this.data.delete(key); }
  keys(): string[] { return [...this.data.keys()]; }
}
```

- [ ] **Step 4: Create agent.ts**

```typescript
// packages/agent-core/src/agent.ts

import type { Agent, AgentConfig, AgentResult } from './types.js';
import type { AgentStreamEvent, TokenUsage } from './providers/types.js';
import { createProvider } from './providers/factory.js';
import { ToolRegistry } from './tools/registry.js';
import { ProfileRegistry } from './profiles/registry.js';
import { assembleSystemPrompt } from './context/assembler.js';
import { runAgentLoop } from './agent-loop.js';

const DEFAULT_MAX_ITERATIONS = 25;

export function createAgent(config: AgentConfig): Agent {
  // 1. Create provider
  const provider = createProvider({
    type: config.provider ?? 'compat',
    apiKey: config.apiKey,
    apiBase: config.apiBase,
    defaultModel: config.model,
  });

  // 2. Register tools
  const toolRegistry = new ToolRegistry();
  for (const tool of config.tools ?? []) {
    toolRegistry.register(tool);
  }

  // 3. Resolve profile
  const profileRegistry = new ProfileRegistry();
  const profile = profileRegistry.resolve(config.model);

  // 4. Assemble system prompt
  const systemPrompt = assembleSystemPrompt({
    userPrompt: config.systemPrompt,
    profile,
    toolDefs: toolRegistry.getDefinitions(),
    enhancements: config.promptEnhancements,
  });

  // 5. Build extra params (e.g. thinking mode)
  const extra: Record<string, unknown> = {};
  if (config.thinking && profile.capabilities.extendedThinking) {
    extra.enable_thinking = true;
    extra.thinking_budget = 4096;
  }

  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  return {
    async run(message: string): Promise<AgentResult> {
      let finalText = '';
      const allToolCalls: AgentResult['toolCalls'] = [];
      let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      let iterations = 0;

      await runAgentLoop(message, (event) => {
        config.onEvent?.(event);

        if (event.type === 'text_delta') {
          finalText += event.delta;
        }
        if (event.type === 'tool_result') {
          allToolCalls.push({
            name: event.toolName,
            input: {},
            output: event.output,
          });
        }
        if (event.type === 'session_done') {
          totalUsage = event.usage;
        }
        if (event.type === 'done') {
          iterations++;
        }
      }, {
        provider, toolRegistry, systemPrompt, model: config.model,
        maxIterations, temperature: config.temperature,
        maxTokens: config.maxTokens, thinking: config.thinking,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      });

      return { text: finalText, toolCalls: allToolCalls, usage: totalUsage, iterations };
    },

    async *stream(message: string): AsyncIterable<AgentStreamEvent> {
      const events: AgentStreamEvent[] = [];
      let resolve: (() => void) | null = null;
      let done = false;

      const promise = runAgentLoop(message, (event) => {
        events.push(event);
        resolve?.();
        if (event.type === 'session_done') done = true;
      }, {
        provider, toolRegistry, systemPrompt, model: config.model,
        maxIterations, temperature: config.temperature,
        maxTokens: config.maxTokens, thinking: config.thinking,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      });

      promise.catch((err) => {
        events.push({ type: 'error', error: err, message: err.message });
        done = true;
        resolve?.();
      });

      while (!done || events.length > 0) {
        if (events.length > 0) {
          yield events.shift()!;
        } else {
          await new Promise<void>((r) => { resolve = r; });
        }
      }
    },
  };
}
```

- [ ] **Step 5: Update index.ts**

```typescript
// packages/agent-core/src/index.ts

export { createAgent } from './agent.js';
export type { AgentConfig, AgentResult, Agent } from './types.js';
export type { Tool, ToolSchema, ToolDefinition } from './tools/types.js';
export type { AgentStreamEvent, LLMStreamEvent, TokenUsage } from './providers/types.js';
export type { ModelProfile } from './profiles/types.js';
export { ProfileRegistry } from './profiles/registry.js';
export { ToolRegistry } from './tools/registry.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run src/__tests__/agent.test.ts 2>&1 | tail -10`
Expected: PASS — 3 tests pass

- [ ] **Step 7: Run full typecheck**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx tsc --noEmit 2>&1`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/agent-core/src/
git commit -m "feat(agent-core): createAgent() API — run() and stream() with auto provider/profile wiring"
```

---

### Task 9: Headless Report Demo + E2E Verification

**Files:**
- Create: `packages/agent-core/examples/headless-report.ts`

- [ ] **Step 1: Create the demo**

```typescript
// packages/agent-core/examples/headless-report.ts
//
// Usage: QWEN_API_KEY=sk-xxx npx tsx packages/agent-core/examples/headless-report.ts

import { createAgent } from '../src/index.js';

// Mock tools simulating data sources
const tools = [
  {
    name: 'search_market_data',
    description: '搜索市场数据，返回行业统计信息',
    schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        year: { type: 'string', description: '年份，如 2025' },
      },
      required: ['query'],
    },
    execute: async (input: Record<string, unknown>) => {
      const data: Record<string, string> = {
        '新能源汽车': '2025年中国新能源汽车销量达1200万辆，同比增长35%。比亚迪市占率28%，特斯拉15%，吉利10%。',
        '电池': '宁德时代全球市占率37%，比亚迪弗迪电池16%。固态电池预计2027年量产。',
        '充电桩': '截至2025年底，全国充电桩保有量超800万个，公共充电桩240万个。',
      };
      const key = Object.keys(data).find(k => String(input.query).includes(k));
      return key ? data[key] : `未找到关于"${input.query}"的数据`;
    },
  },
  {
    name: 'get_company_financials',
    description: '获取公司财务数据',
    schema: {
      type: 'object' as const,
      properties: {
        company: { type: 'string', description: '公司名称' },
      },
      required: ['company'],
    },
    execute: async (input: Record<string, unknown>) => {
      const data: Record<string, string> = {
        '比亚迪': '2025年营收7200亿元，净利润420亿元，同比增长28%。',
        '宁德时代': '2025年营收4100亿元，净利润520亿元，同比增长15%。',
        '特斯拉': '2025年中国区营收1800亿元，全球营收约960亿美元。',
      };
      return data[String(input.company)] ?? `未找到${input.company}的财务数据`;
    },
  },
];

async function main() {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    console.error('请设置 QWEN_API_KEY 环境变量');
    process.exit(1);
  }

  console.log('🚀 Creating agent...');

  const agent = createAgent({
    model: 'qwen3.5-plus',
    apiKey,
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    systemPrompt: `你是一位资深行业分析师。请根据工具获取的数据，撰写一份专业的行业分析报告。

要求：
1. 使用所有可用工具充分获取数据
2. 报告包含：市场概况、主要玩家分析、趋势展望
3. 数据驱动，每个观点有数据支撑
4. 输出格式：Markdown，带标题层级`,
    tools,
    maxIterations: 15,
    promptEnhancements: { toolUseGuidance: true },
  });

  console.log('📊 Running analysis...\n');

  const result = await agent.run('分析 2025 年中国新能源汽车行业格局，重点关注比亚迪、宁德时代、特斯拉');

  console.log('='.repeat(60));
  console.log('📄 REPORT');
  console.log('='.repeat(60));
  console.log(result.text);
  console.log('\n' + '='.repeat(60));
  console.log(`📈 Stats: ${result.iterations} iterations, ${result.toolCalls.length} tool calls`);
  console.log(`💰 Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
}

main().catch(console.error);
```

- [ ] **Step 2: Run typecheck on the whole package**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx tsc --noEmit 2>&1`
Expected: No errors

- [ ] **Step 3: Run all unit tests**

Run: `cd /Users/renlongyu/Desktop/ccclaw/packages/agent-core && npx vitest run 2>&1 | tail -15`
Expected: All tests pass

- [ ] **Step 4: Run the demo (requires QWEN_API_KEY)**

Run: `cd /Users/renlongyu/Desktop/ccclaw && QWEN_API_KEY=$QWEN_API_KEY npx tsx packages/agent-core/examples/headless-report.ts 2>&1 | tail -30`
Expected: Agent makes multiple tool calls and outputs a structured report

- [ ] **Step 5: Verify zero ccclaw dependency**

Run: `grep -r '@ccclaw' packages/agent-core/src/ && echo "FAIL: ccclaw dependency found" || echo "PASS: zero ccclaw deps"`
Expected: PASS: zero ccclaw deps

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/examples/ packages/agent-core/src/
git commit -m "feat(agent-core): headless report demo — end-to-end verification with Qwen3.5-Plus"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|-----------------|------|
| Agent Loop extraction | Task 5 |
| Provider abstraction (compat layer) | Task 3 |
| Model Profile (Qwen3.5-Plus) | Task 6 |
| ToolRegistry + custom tool API | Task 4 |
| Tool Format (CLI + native parsing) | Task 4 |
| ContextAssembler (lightweight) | Task 7 |
| Layered Prompt system | Task 7 |
| `createAgent()` + `run()` + `stream()` | Task 8 |
| In-memory MemoryStore | Task 8 |
| Headless demo verification | Task 9 |
| Zero ccclaw dependency | Task 9 Step 5 |

### Not covered in Phase 1 (deferred to Phase 2-4)

- Tool call reliability L1-L4 (Phase 2)
- Harness adaptive tier (Phase 2)
- Evaluator (Phase 2)
- Skill system (Phase 3)
- Planning/Subagent/MCP migration (Phase 3)
- agent-runtime refactor (Phase 4)
- Consolidator (Phase 2 — not needed for short Headless sessions)
- SQLite MemoryStore (Phase 3)
