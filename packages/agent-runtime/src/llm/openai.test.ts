import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIAdapter } from './openai.js';
import { ProviderConfigError } from './types.js';
import type { ChatParams, LLMStreamEvent } from './types.js';

// ============================================================
// Helpers
// ============================================================

function makeAdapter(overrides: Partial<{ apiKey: string; apiBase: string }> = {}) {
  return new OpenAIAdapter({
    type: 'openai',
    apiKey: overrides.apiKey ?? 'test-api-key',
    apiBase: overrides.apiBase,
  });
}

function makeChatParams(overrides: Partial<ChatParams> = {}): ChatParams {
  return {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

// Build a minimal valid OpenAI chat response
function makeOpenAIResponse(
  content: string,
  finishReason = 'stop',
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>,
  usage = { prompt_tokens: 10, completion_tokens: 5 },
) {
  return {
    choices: [
      {
        message: {
          content: toolCalls ? null : content,
          tool_calls: toolCalls
            ? toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: tc.function,
              }))
            : undefined,
        },
        finish_reason: finishReason,
      },
    ],
    usage,
  };
}

// ============================================================
// capabilities()
// ============================================================

describe('OpenAIAdapter — capabilities()', () => {
  it('returns the expected OpenAI defaults', () => {
    const adapter = makeAdapter();
    const caps = adapter.capabilities();

    expect(caps.streaming).toBe(true);
    expect(caps.toolUse).toBe(true);
    expect(caps.extendedThinking).toBe(false);
    expect(caps.promptCaching).toBe(false);
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(128000);
    expect(caps.maxOutputTokens).toBe(4096);
  });
});

// ============================================================
// Constructor
// ============================================================

describe('OpenAIAdapter — constructor', () => {
  it('throws ProviderConfigError when apiKey is missing', () => {
    expect(
      () => new OpenAIAdapter({ type: 'openai', apiKey: '' }),
    ).toThrow(ProviderConfigError);
  });

  it('throws ProviderConfigError with field=apiKey', () => {
    try {
      new OpenAIAdapter({ type: 'openai', apiKey: '' });
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderConfigError);
      expect((err as ProviderConfigError).field).toBe('apiKey');
    }
  });
});

// ============================================================
// chat() — request format
// ============================================================

describe('OpenAIAdapter — chat()', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = mockFetchResponse(makeOpenAIResponse('Hello!'));
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends POST to /v1/chat/completions with correct body', async () => {
    const adapter = makeAdapter();
    await adapter.chat(makeChatParams());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(body.max_tokens).toBe(4096);
  });

  it('includes Bearer auth header', async () => {
    const adapter = makeAdapter({ apiKey: 'sk-test-bearer' });
    await adapter.chat(makeChatParams());

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-bearer');
  });

  it('respects custom apiBase', async () => {
    const adapter = makeAdapter({ apiBase: 'https://custom.openai.example.com' });
    await adapter.chat(makeChatParams());

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://custom.openai.example.com');
  });

  it('includes systemPrompt as first system message', async () => {
    const adapter = makeAdapter();
    await adapter.chat(makeChatParams({ systemPrompt: 'You are helpful.' }));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('includes temperature when provided', async () => {
    const adapter = makeAdapter();
    await adapter.chat(makeChatParams({ temperature: 0.7 }));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.7);
  });

  it('omits temperature when not provided', async () => {
    const adapter = makeAdapter();
    await adapter.chat(makeChatParams());

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBeUndefined();
  });

  it('includes tools in correct format', async () => {
    const adapter = makeAdapter();
    await adapter.chat(
      makeChatParams({
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            schema: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
      }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the web',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
    ]);
  });

  it('parses choices[0].message.content from response', async () => {
    mockFetch = mockFetchResponse(makeOpenAIResponse('World!'));
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    const result = await adapter.chat(makeChatParams());
    expect(result.content).toBe('World!');
  });

  it('parses tool calls from response', async () => {
    const responseWithTools = makeOpenAIResponse(
      '',
      'tool_calls',
      [
        {
          id: 'call_abc123',
          function: { name: 'search', arguments: '{"query":"vitest"}' },
        },
      ],
    );
    mockFetch = mockFetchResponse(responseWithTools);
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    const result = await adapter.chat(makeChatParams());

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('call_abc123');
    expect(result.toolCalls[0].name).toBe('search');
    expect(result.toolCalls[0].input).toEqual({ query: 'vitest' });
  });

  it('returns empty toolCalls array when response has none', async () => {
    const adapter = makeAdapter();
    const result = await adapter.chat(makeChatParams());
    expect(result.toolCalls).toEqual([]);
  });

  it('maps finish_reason stop → end_turn', async () => {
    mockFetch = mockFetchResponse(makeOpenAIResponse('Hi', 'stop'));
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    const result = await adapter.chat(makeChatParams());
    expect(result.stopReason).toBe('end_turn');
  });

  it('maps finish_reason tool_calls → tool_use', async () => {
    const resp = makeOpenAIResponse('', 'tool_calls', [
      { id: 'tc1', function: { name: 'fn', arguments: '{}' } },
    ]);
    mockFetch = mockFetchResponse(resp);
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    const result = await adapter.chat(makeChatParams());
    expect(result.stopReason).toBe('tool_use');
  });

  it('maps finish_reason length → max_tokens', async () => {
    mockFetch = mockFetchResponse(makeOpenAIResponse('truncated', 'length'));
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    const result = await adapter.chat(makeChatParams());
    expect(result.stopReason).toBe('max_tokens');
  });

  it('maps usage.prompt_tokens → inputTokens and completion_tokens → outputTokens', async () => {
    mockFetch = mockFetchResponse(
      makeOpenAIResponse('Hi', 'stop', undefined, { prompt_tokens: 42, completion_tokens: 17 }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    const result = await adapter.chat(makeChatParams());
    expect(result.usage.inputTokens).toBe(42);
    expect(result.usage.outputTokens).toBe(17);
  });

  it('throws on non-OK response', async () => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    await expect(adapter.chat(makeChatParams())).rejects.toThrow('401');
  });

  it('throws on 429 error (after retries)', async () => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('Too Many Requests'),
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers();

    const adapter = makeAdapter();
    const promise = adapter.chat(makeChatParams()).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('429');
    vi.useRealTimers();
  });

  it('converts tool result messages to role=tool OpenAI format', async () => {
    const adapter = makeAdapter();
    await adapter.chat(
      makeChatParams({
        messages: [
          { role: 'user', content: 'Run search' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'tc1', name: 'search', input: { query: 'test' } }],
          },
          {
            role: 'tool',
            content: '',
            toolResults: [{ toolCallId: 'tc1', output: 'result text' }],
          },
        ],
      }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const toolMsg = body.messages.find(
      (m: { role: string }) => m.role === 'tool',
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe('tc1');
    expect(toolMsg.content).toBe('result text');
  });
});

// ============================================================
// stream() — SSE parsing
// ============================================================

function buildSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
}

function makeStreamFetch(sseLines: string[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: buildSSEStream(sseLines),
  });
}

async function collectStreamEvents(
  adapter: OpenAIAdapter,
  params: ChatParams,
): Promise<LLMStreamEvent[]> {
  const events: LLMStreamEvent[] = [];
  for await (const event of adapter.stream(params)) {
    events.push(event);
  }
  return events;
}

describe('OpenAIAdapter — stream()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('yields text_delta events from delta.content', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":" World"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ];
    vi.stubGlobal('fetch', makeStreamFetch(sseLines));

    const adapter = makeAdapter();
    const events = await collectStreamEvents(adapter, makeChatParams());

    const textDeltas = events.filter((e) => e.type === 'text_delta');
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as { type: 'text_delta'; delta: string }).delta).toBe('Hello');
    expect((textDeltas[1] as { type: 'text_delta'; delta: string }).delta).toBe(' World');
  });

  it('yields done event with correct stopReason on [DONE]', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ];
    vi.stubGlobal('fetch', makeStreamFetch(sseLines));

    const adapter = makeAdapter();
    const events = await collectStreamEvents(adapter, makeChatParams());

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect((doneEvent as { type: 'done'; stopReason: string }).stopReason).toBe('end_turn');
  });

  it('yields tool_use_start and tool_use_delta for tool call streaming', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xyz","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ];
    vi.stubGlobal('fetch', makeStreamFetch(sseLines));

    const adapter = makeAdapter();
    const events = await collectStreamEvents(adapter, makeChatParams());

    const startEvt = events.find((e) => e.type === 'tool_use_start') as
      | { type: 'tool_use_start'; toolCallId: string; name: string }
      | undefined;
    expect(startEvt).toBeDefined();
    expect(startEvt!.toolCallId).toBe('call_xyz');
    expect(startEvt!.name).toBe('search');

    const deltaEvts = events.filter((e) => e.type === 'tool_use_delta');
    expect(deltaEvts.length).toBeGreaterThan(0);

    const endEvt = events.find((e) => e.type === 'tool_use_end') as
      | { type: 'tool_use_end'; toolCallId: string }
      | undefined;
    expect(endEvt).toBeDefined();
    expect(endEvt!.toolCallId).toBe('call_xyz');
  });

  it('yields usage event when final chunk contains usage', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":3}}',
      'data: [DONE]',
    ];
    vi.stubGlobal('fetch', makeStreamFetch(sseLines));

    const adapter = makeAdapter();
    const events = await collectStreamEvents(adapter, makeChatParams());

    const usageEvt = events.find((e) => e.type === 'usage') as
      | { type: 'usage'; usage: { inputTokens: number; outputTokens: number } }
      | undefined;
    expect(usageEvt).toBeDefined();
    expect(usageEvt!.usage.inputTokens).toBe(8);
    expect(usageEvt!.usage.outputTokens).toBe(3);
  });

  it('sends stream:true in request body', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ];
    const mockFetch = makeStreamFetch(sseLines);
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    await collectStreamEvents(adapter, makeChatParams());

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
  });

  it('throws on non-OK stream response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const adapter = makeAdapter();
    await expect(collectStreamEvents(adapter, makeChatParams())).rejects.toThrow('500');
  });
});
