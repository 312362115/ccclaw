/**
 * Tests for AnthropicAdapter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';
import { ProviderConfigError } from './types.js';

// ============================================================
// Helpers
// ============================================================

function makeOkResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    body: null,
  } as unknown as Response;
}

function makeErrorResponse(status: number, errorBody: unknown): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(errorBody),
    body: null,
  } as unknown as Response;
}

function makeAnthropicChatResponse(overrides: Partial<{
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}> = {}) {
  return {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: overrides.content ?? [{ type: 'text', text: 'Hello world' }],
    stop_reason: overrides.stop_reason ?? 'end_turn',
    usage: overrides.usage ?? { input_tokens: 10, output_tokens: 20 },
  };
}

// ============================================================
// Tests
// ============================================================

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. capabilities() ─────────────────────────────────────

  describe('capabilities()', () => {
    it('returns Claude defaults', () => {
      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      const caps = adapter.capabilities();

      expect(caps.streaming).toBe(true);
      expect(caps.toolUse).toBe(true);
      expect(caps.extendedThinking).toBe(true);
      expect(caps.promptCaching).toBe(true);
      expect(caps.vision).toBe(true);
      expect(caps.contextWindow).toBe(200000);
      expect(caps.maxOutputTokens).toBe(8192);
    });
  });

  // ── 2. Constructor validation ──────────────────────────────

  describe('constructor', () => {
    it('throws ProviderConfigError when apiKey is missing', () => {
      expect(
        () => new AnthropicAdapter({ type: 'anthropic', apiKey: '' }),
      ).toThrow(ProviderConfigError);
    });

    it('throws ProviderConfigError with field=apiKey', () => {
      try {
        new AnthropicAdapter({ type: 'anthropic', apiKey: '' });
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderConfigError);
        expect((err as ProviderConfigError).field).toBe('apiKey');
      }
    });
  });

  // ── 3. chat() — basic request/response ────────────────────

  describe('chat()', () => {
    it('sends correct format and parses response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(makeAnthropicChatResponse()),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      const result = await adapter.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string);
      expect(body.model).toBe('claude-3-5-sonnet-20241022');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');

      expect(result.content).toBe('Hello world');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(20);
      expect(result.stopReason).toBe('end_turn');
    });

    // ── 4. OAuth token uses Bearer auth header ───────────────

    it('uses Authorization: Bearer header for oauth_ keys', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(makeAnthropicChatResponse()),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({
        type: 'anthropic',
        apiKey: 'oauth_token_abc123',
      });
      await adapter.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer oauth_token_abc123');
      expect(headers['x-api-key']).toBeUndefined();
    });

    // ── 5. API key uses x-api-key header ─────────────────────

    it('uses x-api-key header for non-oauth keys', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(makeAnthropicChatResponse()),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      await adapter.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant-test');
      expect(headers['Authorization']).toBeUndefined();
    });

    // ── 6. anthropic-version header is always sent ───────────

    it('always sends anthropic-version header', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(makeAnthropicChatResponse()),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      await adapter.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    // ── 7. Parses tool_use content blocks ────────────────────

    it('parses tool_use content blocks from response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(
          makeAnthropicChatResponse({
            content: [
              {
                type: 'tool_use',
                id: 'call_abc',
                name: 'get_weather',
                input: { location: 'NYC' },
              },
            ],
            stop_reason: 'tool_use',
          }),
        ),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      const result = await adapter.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a location',
            schema: {
              type: 'object',
              properties: { location: { type: 'string' } },
            },
          },
        ],
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].id).toBe('call_abc');
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].input).toEqual({ location: 'NYC' });
      expect(result.stopReason).toBe('tool_use');
    });

    // ── 8. Extended thinking config ──────────────────────────

    it('includes thinking config in request body when thinkingConfig is set', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(makeAnthropicChatResponse()),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      await adapter.chat({
        model: 'claude-3-7-sonnet-20250219',
        messages: [{ role: 'user', content: 'Think hard' }],
        thinkingConfig: { budgetTokens: 5000 },
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 });
    });

    // ── 9. Error response throws with status code ─────────────

    it('throws error with status code on API error response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeErrorResponse(401, {
          type: 'error',
          error: { type: 'authentication_error', message: 'Invalid API key' },
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-bad-key' });
      await expect(
        adapter.chat({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('401');
    });

    it('uses custom apiBase when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(makeAnthropicChatResponse()),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({
        type: 'anthropic',
        apiKey: 'sk-ant-test',
        apiBase: 'https://custom-proxy.example.com',
      });
      await adapter.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://custom-proxy.example.com/v1/messages');
    });

    it('includes system prompt when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(makeAnthropicChatResponse()),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      await adapter.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helpful assistant.',
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.system).toBe('You are a helpful assistant.');
    });

    it('converts tools to input_schema format', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOkResponse(makeAnthropicChatResponse()),
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      await adapter.chat({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          {
            name: 'my_tool',
            description: 'A test tool',
            schema: { type: 'object', properties: { x: { type: 'number' } } },
          },
        ],
      });

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0]).toEqual({
        name: 'my_tool',
        description: 'A test tool',
        input_schema: { type: 'object', properties: { x: { type: 'number' } } },
      });
    });
  });

  // ── 10. stream() ─────────────────────────────────────────

  describe('stream()', () => {
    function makeSSEStream(events: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(event + '\n'));
          }
          controller.close();
        },
      });
    }

    function sseData(obj: unknown): string {
      return `data: ${JSON.stringify(obj)}`;
    }

    it('streams text_delta events', async () => {
      const events = [
        sseData({
          type: 'message_start',
          message: { usage: { input_tokens: 5, output_tokens: 0 } },
        }),
        sseData({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        sseData({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
        sseData({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } }),
        sseData({ type: 'content_block_stop', index: 0 }),
        sseData({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 10 },
        }),
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: makeSSEStream(events),
      });
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      const collected: Array<{ type: string }> = [];
      for await (const event of adapter.stream({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        collected.push(event);
      }

      const textDeltas = collected.filter((e) => e.type === 'text_delta');
      expect(textDeltas).toHaveLength(2);
      expect((textDeltas[0] as { type: 'text_delta'; delta: string }).delta).toBe('Hello');
      expect((textDeltas[1] as { type: 'text_delta'; delta: string }).delta).toBe(' world');

      const doneEvents = collected.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
      expect((doneEvents[0] as { type: 'done'; stopReason: string }).stopReason).toBe('end_turn');
    });

    it('streams tool_use_start, tool_use_delta, and tool_use_end events', async () => {
      const events = [
        sseData({
          type: 'message_start',
          message: { usage: { input_tokens: 5, output_tokens: 0 } },
        }),
        sseData({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_xyz', name: 'search', input: '' },
        }),
        sseData({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"q"' },
        }),
        sseData({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: ': "test"}' },
        }),
        sseData({ type: 'content_block_stop', index: 0 }),
        sseData({
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 15 },
        }),
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: makeSSEStream(events),
      });
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      const collected: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Search for something' }],
      })) {
        collected.push(event as { type: string; [k: string]: unknown });
      }

      const startEvent = collected.find((e) => e.type === 'tool_use_start');
      expect(startEvent).toBeDefined();
      expect(startEvent!.toolCallId).toBe('call_xyz');
      expect(startEvent!.name).toBe('search');

      const deltaEvents = collected.filter((e) => e.type === 'tool_use_delta');
      expect(deltaEvents).toHaveLength(2);
      expect(deltaEvents[0].delta).toBe('{"q"');
      expect(deltaEvents[1].delta).toBe(': "test"}');

      const endEvent = collected.find((e) => e.type === 'tool_use_end');
      expect(endEvent).toBeDefined();
      expect(endEvent!.toolCallId).toBe('call_xyz');

      const doneEvent = collected.find((e) => e.type === 'done');
      expect(doneEvent!.stopReason).toBe('tool_use');
    });

    it('emits thinking_delta events', async () => {
      const events = [
        sseData({
          type: 'message_start',
          message: { usage: { input_tokens: 5, output_tokens: 0 } },
        }),
        sseData({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }),
        sseData({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Let me think...' },
        }),
        sseData({ type: 'content_block_stop', index: 0 }),
        sseData({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 5 },
        }),
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: makeSSEStream(events),
      });
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      const collected: Array<{ type: string; [k: string]: unknown }> = [];
      for await (const event of adapter.stream({
        model: 'claude-3-7-sonnet-20250219',
        messages: [{ role: 'user', content: 'Think about this' }],
        thinkingConfig: { budgetTokens: 1024 },
      })) {
        collected.push(event as { type: string; [k: string]: unknown });
      }

      const thinkingDeltas = collected.filter((e) => e.type === 'thinking_delta');
      expect(thinkingDeltas).toHaveLength(1);
      expect(thinkingDeltas[0].delta).toBe('Let me think...');
    });

    it('throws on stream error response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 529,
        json: () => Promise.resolve({
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
        body: null,
      });
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      await expect(async () => {
        for await (const _ of adapter.stream({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hello' }],
        })) {
          // consume
        }
      }).rejects.toThrow('529');
    });

    it('includes stream: true in request body', async () => {
      const events = [
        sseData({
          type: 'message_start',
          message: { usage: { input_tokens: 1, output_tokens: 0 } },
        }),
        sseData({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 1 },
        }),
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: makeSSEStream(events),
      });
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter({ type: 'anthropic', apiKey: 'sk-ant-test' });
      for await (const _ of adapter.stream({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        // consume
      }

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.stream).toBe(true);
    });
  });
});
