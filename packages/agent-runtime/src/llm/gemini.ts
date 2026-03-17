/**
 * GeminiAdapter — Google Gemini API adapter using native fetch.
 *
 * Implements LLMProvider interface using the Gemini generateContent API.
 * Supports chat, streaming (SSE), function calling, and system instructions.
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMToolDefinition,
  ChatParams,
  ChatResponse,
  LLMStreamEvent,
  ProviderCapabilities,
  ProviderConfig,
  StopReason,
  LLMToolCall,
} from './types.js';
import { ProviderConfigError } from './types.js';
import { withRetry, sanitizeMessages } from './base.js';

// ====== Gemini API Types ======

interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

interface GeminiGenerationConfig {
  maxOutputTokens: number;
  temperature?: number;
}

interface GeminiRequestBody {
  contents: GeminiContent[];
  tools?: GeminiTool[];
  generationConfig: GeminiGenerationConfig;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[];
    role: string;
  };
  finishReason?: string;
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

// ====== Helper: generate unique IDs ======

let toolCallCounter = 0;
function generateToolCallId(): string {
  return `gemini-tool-${Date.now()}-${++toolCallCounter}`;
}

// ====== Message Conversion ======

/**
 * Converts internal LLMMessage array to Gemini API contents format.
 * System messages are extracted separately.
 */
function buildGeminiContents(messages: LLMMessage[]): {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
} {
  const sanitized = sanitizeMessages(messages);
  const contents: GeminiContent[] = [];
  let systemInstruction: { parts: Array<{ text: string }> } | undefined;

  for (const msg of sanitized) {
    if (msg.role === 'system' as string) {
      // System messages become systemInstruction
      if (msg.content) {
        systemInstruction = { parts: [{ text: msg.content }] };
      }
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results: functionResponse parts
      const parts: GeminiPart[] = [];
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          let responseData: Record<string, unknown>;
          try {
            responseData = JSON.parse(tr.output) as Record<string, unknown>;
          } catch {
            responseData = { result: tr.output };
          }
          // We need the tool name — store it in toolResults or use toolCallId as name fallback
          parts.push({
            functionResponse: {
              name: tr.toolCallId, // Will be overridden if we have better name info
              response: responseData,
            },
          });
        }
      } else if (msg.content) {
        // Fallback: treat content as a single function response
        let responseData: Record<string, unknown>;
        try {
          responseData = JSON.parse(msg.content) as Record<string, unknown>;
        } catch {
          responseData = { result: msg.content };
        }
        parts.push({
          functionResponse: {
            name: 'tool',
            response: responseData,
          },
        });
      }
      if (parts.length > 0) {
        contents.push({ role: 'user', parts });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: GeminiPart[] = [];

      // Add text content if present
      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Add tool calls as functionCall parts
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.input as Record<string, unknown>,
            },
          });
        }
      }

      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
      continue;
    }

    // user role
    if (msg.content) {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
    }
  }

  return { contents, systemInstruction };
}

/**
 * Converts LLMToolDefinition[] to Gemini tools format.
 */
function buildGeminiTools(tools: LLMToolDefinition[]): GeminiTool[] {
  if (tools.length === 0) return [];
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.schema,
      })),
    },
  ];
}

/**
 * Parses Gemini candidate parts into text content and tool calls.
 */
function parseCandidateParts(parts: GeminiPart[]): {
  content: string;
  toolCalls: LLMToolCall[];
} {
  let content = '';
  const toolCalls: LLMToolCall[] = [];

  for (const part of parts) {
    if (part.text !== undefined) {
      content += part.text;
    }
    if (part.functionCall) {
      toolCalls.push({
        id: generateToolCallId(),
        name: part.functionCall.name,
        input: part.functionCall.args,
      });
    }
  }

  return { content, toolCalls };
}

/**
 * Maps Gemini finishReason to internal StopReason.
 */
function mapFinishReason(
  finishReason: string | undefined,
  hasToolCalls: boolean,
): StopReason {
  if (hasToolCalls) return 'tool_use';
  if (finishReason === 'MAX_TOKENS') return 'max_tokens';
  return 'end_turn';
}

// ====== GeminiAdapter ======

export class GeminiAdapter implements LLMProvider {
  private readonly apiKey: string;
  private readonly apiBase: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new ProviderConfigError('Gemini API key is required', 'apiKey');
    }
    this.apiKey = config.apiKey;
    this.apiBase =
      config.apiBase ?? 'https://generativelanguage.googleapis.com';
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      extendedThinking: false,
      promptCaching: false,
      vision: true,
      contextWindow: 1_000_000,
      maxOutputTokens: 8192,
    };
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    return withRetry(() => this.rawChat(params));
  }

  private async rawChat(params: ChatParams): Promise<ChatResponse> {
    const { model, messages, tools = [], systemPrompt, maxTokens, temperature, signal } = params;

    const { contents, systemInstruction: msgSystemInstruction } =
      buildGeminiContents(messages);

    // systemPrompt from ChatParams takes precedence over any system message
    const systemInstruction = systemPrompt
      ? { parts: [{ text: systemPrompt }] }
      : msgSystemInstruction;

    const body: GeminiRequestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens ?? 8192,
        ...(temperature !== undefined ? { temperature } : { temperature: 0.1 }),
      },
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (tools.length > 0) {
      body.tools = buildGeminiTools(tools);
    }

    const url = `${this.apiBase}/v1beta/models/${model}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as GeminiResponse;

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error('Gemini API returned no candidates');
    }

    // Safety check
    if (candidate.finishReason === 'SAFETY') {
      const ratings = JSON.stringify(candidate.safetyRatings ?? []);
      throw new Error(`Gemini response blocked by safety filters: ${ratings}`);
    }

    const parts = candidate.content?.parts ?? [];
    const { content, toolCalls } = parseCandidateParts(parts);

    const stopReason = mapFinishReason(candidate.finishReason, toolCalls.length > 0);

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      stopReason,
    };
  }

  async *stream(params: ChatParams): AsyncIterable<LLMStreamEvent> {
    const { model, messages, tools = [], systemPrompt, maxTokens, temperature, signal } = params;

    const { contents, systemInstruction: msgSystemInstruction } =
      buildGeminiContents(messages);

    const systemInstruction = systemPrompt
      ? { parts: [{ text: systemPrompt }] }
      : msgSystemInstruction;

    const body: GeminiRequestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens ?? 8192,
        ...(temperature !== undefined ? { temperature } : { temperature: 0.1 }),
      },
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (tools.length > 0) {
      body.tools = buildGeminiTools(tools);
    }

    const url = `${this.apiBase}/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    if (!res.body) {
      throw new Error('Gemini stream response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const activeToolCalls = new Map<string, string>(); // name -> id
    let lastFinishReason: string | undefined;
    let lastUsage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice('data: '.length);
          if (jsonStr === '[DONE]') continue;

          let chunk: GeminiResponse;
          try {
            chunk = JSON.parse(jsonStr) as GeminiResponse;
          } catch {
            continue;
          }

          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;

          if (candidate.finishReason === 'SAFETY') {
            const ratings = JSON.stringify(candidate.safetyRatings ?? []);
            yield {
              type: 'error',
              error: new Error(`Gemini response blocked by safety filters: ${ratings}`),
            };
            return;
          }

          lastFinishReason = candidate.finishReason;

          if (chunk.usageMetadata) {
            lastUsage = chunk.usageMetadata;
          }

          const parts = candidate.content?.parts ?? [];

          for (const part of parts) {
            if (part.text !== undefined) {
              yield { type: 'text_delta', delta: part.text };
            }

            if (part.functionCall) {
              const name = part.functionCall.name;
              let toolCallId = activeToolCalls.get(name);

              if (!toolCallId) {
                toolCallId = generateToolCallId();
                activeToolCalls.set(name, toolCallId);
                yield { type: 'tool_use_start', toolCallId, name };
              }

              const delta = JSON.stringify(part.functionCall.args);
              yield { type: 'tool_use_delta', toolCallId, delta };
              yield { type: 'tool_use_end', toolCallId };
              // Remove after ending so repeated calls get new IDs
              activeToolCalls.delete(name);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit usage if available
    if (lastUsage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: lastUsage.promptTokenCount ?? 0,
          outputTokens: lastUsage.candidatesTokenCount ?? 0,
        },
      };
    }

    // Determine stop reason
    const hasActiveCalls = activeToolCalls.size > 0;
    const stopReason = mapFinishReason(lastFinishReason, hasActiveCalls);
    yield { type: 'done', stopReason };
  }
}
