import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiAdapter } from './gemini.js';
import type { ChatParams, LLMMessage } from './types.js';
import { ProviderConfigError } from './types.js';

// ====== Helpers ======

function makeAdapter(overrides?: { apiKey?: string; apiBase?: string }) {
  return new GeminiAdapter({
    type: 'gemini',
    apiKey: overrides?.apiKey ?? 'test-api-key',
    apiBase: overrides?.apiBase ?? 'https://generativelanguage.googleapis.com',
  });
}

function makeChatParams(overrides?: Partial<ChatParams>): ChatParams {
  return {
    model: 'gemini-1.5-pro',
    messages: [{ role: 'user', content: 'Hello, Gemini!' }],
    ...overrides,
  };
}

function makeGeminiResponse(overrides?: {
  parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }>;
  finishReason?: string;
  safetyRatings?: Array<{ category: string; probability: string }>;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
}) {
  return {
    candidates: [
      {
        content: {
          parts: overrides?.parts ?? [{ text: 'Hello from Gemini!' }],
          role: 'model',
        },
        finishReason: overrides?.finishReason ?? 'STOP',
        safetyRatings: overrides?.safetyRatings,
      },
    ],
    usageMetadata: overrides?.usageMetadata ?? {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
    },
  };
}

function mockFetch(response: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

// ====== Tests ======

describe('GeminiAdapter', () => {
  let globalFetch: typeof fetch;

  beforeEach(() => {
    globalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = globalFetch;
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------------
  // 1. Constructor
  // ----------------------------------------------------------------

  describe('constructor', () => {
    it('throws ProviderConfigError when apiKey is missing', () => {
      expect(() =>
        new GeminiAdapter({ type: 'gemini', apiKey: '' }),
      ).toThrow(ProviderConfigError);
    });

    it('throws ProviderConfigError with field=apiKey', () => {
      try {
        new GeminiAdapter({ type: 'gemini', apiKey: '' });
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderConfigError);
        expect((err as ProviderConfigError).field).toBe('apiKey');
      }
    });

    it('creates adapter with valid config', () => {
      expect(() => makeAdapter()).not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // 2. capabilities()
  // ----------------------------------------------------------------

  describe('capabilities()', () => {
    it('returns Gemini defaults', () => {
      const caps = makeAdapter().capabilities();
      expect(caps.streaming).toBe(true);
      expect(caps.toolUse).toBe(true);
      expect(caps.extendedThinking).toBe(false);
      expect(caps.promptCaching).toBe(false);
      expect(caps.vision).toBe(true);
    });

    it('returns contextWindow=1000000', () => {
      expect(makeAdapter().capabilities().contextWindow).toBe(1_000_000);
    });

    it('returns maxOutputTokens=8192', () => {
      expect(makeAdapter().capabilities().maxOutputTokens).toBe(8192);
    });
  });

  // ----------------------------------------------------------------
  // 3. chat() — request format
  // ----------------------------------------------------------------

  describe('chat() request format', () => {
    it('sends correct Gemini format with contents/parts', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      const adapter = makeAdapter();
      await adapter.chat(makeChatParams());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      expect(body).toHaveProperty('contents');
      expect(body.contents[0]).toMatchObject({
        role: 'user',
        parts: [{ text: 'Hello, Gemini!' }],
      });
      expect(body).toHaveProperty('generationConfig');
    });

    it('sends Bearer auth header', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      await makeAdapter({ apiKey: 'my-token' }).chat(makeChatParams());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-token');
    });

    it('hits the correct endpoint', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      await makeAdapter().chat(makeChatParams({ model: 'gemini-1.5-pro' }));

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('/v1beta/models/gemini-1.5-pro:generateContent');
    });

    it('places systemPrompt as systemInstruction', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      await makeAdapter().chat(
        makeChatParams({ systemPrompt: 'You are a helpful assistant.' }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.systemInstruction).toMatchObject({
        parts: [{ text: 'You are a helpful assistant.' }],
      });
    });

    it('does not include systemInstruction when no system prompt', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      await makeAdapter().chat(makeChatParams());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.systemInstruction).toBeUndefined();
    });

    it('includes tools as functionDeclarations', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      await makeAdapter().chat(
        makeChatParams({
          tools: [
            {
              name: 'search',
              description: 'Search the web',
              schema: { type: 'object', properties: { q: { type: 'string' } } },
            },
          ],
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.tools[0].functionDeclarations[0]).toMatchObject({
        name: 'search',
        description: 'Search the web',
      });
    });

    it('maps assistant role to model role', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'How are you?' },
      ];

      await makeAdapter().chat(makeChatParams({ messages }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.contents[1].role).toBe('model');
    });
  });

  // ----------------------------------------------------------------
  // 4. chat() — response parsing
  // ----------------------------------------------------------------

  describe('chat() response parsing', () => {
    it('parses text response correctly', async () => {
      global.fetch = mockFetch(makeGeminiResponse({ parts: [{ text: 'Hello!' }] }));

      const result = await makeAdapter().chat(makeChatParams());
      expect(result.content).toBe('Hello!');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.stopReason).toBe('end_turn');
    });

    it('parses functionCall from response parts', async () => {
      global.fetch = mockFetch(
        makeGeminiResponse({
          parts: [
            {
              functionCall: {
                name: 'get_weather',
                args: { location: 'Tokyo' },
              },
            },
          ],
          finishReason: 'STOP',
        }),
      );

      const result = await makeAdapter().chat(makeChatParams());
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].input).toMatchObject({ location: 'Tokyo' });
      expect(result.stopReason).toBe('tool_use');
    });

    it('handles mixed text + functionCall in same candidate', async () => {
      global.fetch = mockFetch(
        makeGeminiResponse({
          parts: [
            { text: 'I will search for that.' },
            {
              functionCall: {
                name: 'search',
                args: { query: 'vitest' },
              },
            },
          ],
          finishReason: 'STOP',
        }),
      );

      const result = await makeAdapter().chat(makeChatParams());
      expect(result.content).toBe('I will search for that.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.stopReason).toBe('tool_use');
    });

    it('maps MAX_TOKENS finishReason to max_tokens stopReason', async () => {
      global.fetch = mockFetch(
        makeGeminiResponse({ finishReason: 'MAX_TOKENS' }),
      );

      const result = await makeAdapter().chat(makeChatParams());
      expect(result.stopReason).toBe('max_tokens');
    });

    it('maps STOP finishReason to end_turn stopReason', async () => {
      global.fetch = mockFetch(makeGeminiResponse({ finishReason: 'STOP' }));

      const result = await makeAdapter().chat(makeChatParams());
      expect(result.stopReason).toBe('end_turn');
    });

    it('reports usage tokens correctly', async () => {
      global.fetch = mockFetch(
        makeGeminiResponse({
          usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 99 },
        }),
      );

      const result = await makeAdapter().chat(makeChatParams());
      expect(result.usage.inputTokens).toBe(42);
      expect(result.usage.outputTokens).toBe(99);
    });
  });

  // ----------------------------------------------------------------
  // 5. Safety check
  // ----------------------------------------------------------------

  describe('SAFETY finishReason', () => {
    it('throws an error when finishReason is SAFETY', async () => {
      global.fetch = mockFetch(
        makeGeminiResponse({
          finishReason: 'SAFETY',
          safetyRatings: [
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH' },
          ],
        }),
      );

      await expect(makeAdapter().chat(makeChatParams())).rejects.toThrow(
        /safety/i,
      );
    });

    it('includes safety ratings in the error message', async () => {
      global.fetch = mockFetch(
        makeGeminiResponse({
          finishReason: 'SAFETY',
          safetyRatings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'MEDIUM' },
          ],
        }),
      );

      await expect(makeAdapter().chat(makeChatParams())).rejects.toThrow(
        'HARM_CATEGORY_HATE_SPEECH',
      );
    });
  });

  // ----------------------------------------------------------------
  // 6. systemInstruction placement
  // ----------------------------------------------------------------

  describe('systemInstruction placement', () => {
    it('places systemInstruction at top level (not in contents)', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      await makeAdapter().chat(
        makeChatParams({
          systemPrompt: 'Be concise.',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      // systemInstruction is top-level
      expect(body.systemInstruction.parts[0].text).toBe('Be concise.');

      // No system role in contents
      const hasSystemContent = body.contents.some(
        (c: { role: string }) => c.role === 'system',
      );
      expect(hasSystemContent).toBe(false);
    });

    it('extracts system message from messages array when no systemPrompt', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      const messages: LLMMessage[] = [
        { role: 'system' as LLMMessage['role'], content: 'Be helpful.' },
        { role: 'user', content: 'Hi' },
      ];

      await makeAdapter().chat(makeChatParams({ messages }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      expect(body.systemInstruction.parts[0].text).toBe('Be helpful.');
      // System message should not appear in contents
      const hasSystemContent = body.contents.some(
        (c: { role: string }) => c.role === 'system',
      );
      expect(hasSystemContent).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // 7. Error handling
  // ----------------------------------------------------------------

  describe('error handling', () => {
    it('throws on non-OK HTTP response', async () => {
      global.fetch = mockFetch({ error: 'Unauthorized' }, 401);

      await expect(makeAdapter().chat(makeChatParams())).rejects.toThrow(
        'Gemini API error 401',
      );
    });

    it('throws when candidates array is empty', async () => {
      global.fetch = mockFetch({ candidates: [] });

      await expect(makeAdapter().chat(makeChatParams())).rejects.toThrow(
        'no candidates',
      );
    });
  });

  // ----------------------------------------------------------------
  // 8. Custom apiBase
  // ----------------------------------------------------------------

  describe('custom apiBase', () => {
    it('uses default apiBase when not provided', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      await makeAdapter().chat(makeChatParams({ model: 'gemini-pro' }));

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('https://generativelanguage.googleapis.com');
    });

    it('uses custom apiBase when provided', async () => {
      const fetchMock = mockFetch(makeGeminiResponse());
      global.fetch = fetchMock;

      await makeAdapter({ apiBase: 'https://custom.api.example.com' }).chat(
        makeChatParams({ model: 'gemini-pro' }),
      );

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('https://custom.api.example.com');
    });
  });

  // ----------------------------------------------------------------
  // 9. Multiple tool calls
  // ----------------------------------------------------------------

  describe('multiple tool calls', () => {
    it('parses multiple functionCalls from parts', async () => {
      global.fetch = mockFetch(
        makeGeminiResponse({
          parts: [
            { functionCall: { name: 'tool_a', args: { x: 1 } } },
            { functionCall: { name: 'tool_b', args: { y: 2 } } },
          ],
          finishReason: 'STOP',
        }),
      );

      const result = await makeAdapter().chat(makeChatParams());
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('tool_a');
      expect(result.toolCalls[1].name).toBe('tool_b');
      expect(result.stopReason).toBe('tool_use');
    });

    it('assigns unique IDs to each tool call', async () => {
      global.fetch = mockFetch(
        makeGeminiResponse({
          parts: [
            { functionCall: { name: 'tool_a', args: {} } },
            { functionCall: { name: 'tool_b', args: {} } },
          ],
        }),
      );

      const result = await makeAdapter().chat(makeChatParams());
      expect(result.toolCalls[0].id).not.toBe(result.toolCalls[1].id);
    });
  });
});
