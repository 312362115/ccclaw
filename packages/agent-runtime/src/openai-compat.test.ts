import { describe, it, expect } from 'vitest';
import {
  parseOpenAIRequest,
  extractUserMessage,
  sseChunk,
  sseDone,
  nonStreamingResponse,
  shouldEmitToClient,
  nextCompletionId,
} from './openai-compat.js';
import type { AgentStreamEvent } from './llm/types.js';

describe('OpenAI Compat', () => {
  describe('parseOpenAIRequest', () => {
    it('should parse valid request', () => {
      const result = parseOpenAIRequest({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      });
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.messages).toHaveLength(1);
        expect(result.stream).toBe(true);
        expect(result.model).toBe('gpt-4');
      }
    });

    it('should reject empty messages', () => {
      const result = parseOpenAIRequest({ messages: [] });
      expect('error' in result).toBe(true);
    });

    it('should reject null body', () => {
      const result = parseOpenAIRequest(null);
      expect('error' in result).toBe(true);
    });

    it('should default stream to false', () => {
      const result = parseOpenAIRequest({
        messages: [{ role: 'user', content: 'hi' }],
      });
      if (!('error' in result)) {
        expect(result.stream).toBe(false);
      }
    });
  });

  describe('extractUserMessage', () => {
    it('should extract last user message', () => {
      const msg = extractUserMessage([
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'second question' },
      ]);
      expect(msg).toBe('second question');
    });

    it('should fallback to last message if no user message', () => {
      const msg = extractUserMessage([
        { role: 'system', content: 'instructions' },
      ]);
      expect(msg).toBe('instructions');
    });
  });

  describe('sseChunk', () => {
    it('should generate valid SSE format', () => {
      const chunk = sseChunk('id-1', 'model-1', { content: 'hello' }, null);
      expect(chunk).toMatch(/^data: /);
      expect(chunk).toMatch(/\n\n$/);
      const parsed = JSON.parse(chunk.replace('data: ', '').trim());
      expect(parsed.id).toBe('id-1');
      expect(parsed.model).toBe('model-1');
      expect(parsed.choices[0].delta.content).toBe('hello');
      expect(parsed.choices[0].finish_reason).toBeNull();
    });

    it('should include finish_reason when provided', () => {
      const chunk = sseChunk('id-1', 'model-1', {}, 'stop');
      const parsed = JSON.parse(chunk.replace('data: ', '').trim());
      expect(parsed.choices[0].finish_reason).toBe('stop');
    });
  });

  describe('sseDone', () => {
    it('should return [DONE] marker', () => {
      expect(sseDone()).toBe('data: [DONE]\n\n');
    });
  });

  describe('nonStreamingResponse', () => {
    it('should generate valid response', () => {
      const resp = nonStreamingResponse('id-1', 'model-1', 'hello world', 100, 50);
      expect(resp.object).toBe('chat.completion');
      expect(resp.choices[0].message?.content).toBe('hello world');
      expect(resp.choices[0].finish_reason).toBe('stop');
      expect(resp.usage?.total_tokens).toBe(150);
    });
  });

  describe('shouldEmitToClient — 工具调用对外不可见', () => {
    it('should emit text_delta', () => {
      const result = shouldEmitToClient({ type: 'text_delta', delta: 'hello' });
      expect(result).toEqual({ type: 'text', text: 'hello' });
    });

    it('should emit session_done', () => {
      const result = shouldEmitToClient({ type: 'session_done', usage: { inputTokens: 10, outputTokens: 5 } });
      expect(result).toEqual({ type: 'done', inputTokens: 10, outputTokens: 5 });
    });

    it('should hide tool_use_start', () => {
      expect(shouldEmitToClient({ type: 'tool_use_start', toolCallId: 'tc1', name: 'bash' })).toBeNull();
    });

    it('should hide tool_use_delta', () => {
      expect(shouldEmitToClient({ type: 'tool_use_delta', toolCallId: 'tc1', delta: '{}' })).toBeNull();
    });

    it('should hide tool_result', () => {
      expect(shouldEmitToClient({ type: 'tool_result', toolCallId: 'tc1', output: 'ok' })).toBeNull();
    });

    it('should hide thinking_delta', () => {
      expect(shouldEmitToClient({ type: 'thinking_delta', delta: 'hmm' })).toBeNull();
    });

    it('should hide confirm_request', () => {
      expect(shouldEmitToClient({ type: 'confirm_request', confirmId: 'c1', toolName: 'bash', input: {} })).toBeNull();
    });
  });

  describe('nextCompletionId', () => {
    it('should generate unique ids', () => {
      const a = nextCompletionId();
      const b = nextCompletionId();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^chatcmpl-/);
    });
  });
});
