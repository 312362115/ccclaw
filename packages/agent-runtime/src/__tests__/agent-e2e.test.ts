/**
 * Agent Loop E2E Integration Test
 *
 * Exercises the full flow: message -> Agent Loop -> LLM call -> tool execution -> response
 * using a MockLLMProvider (no real API calls).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runAgent, type AgentDeps, type StreamCallback } from '../agent.js';
import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  LLMStreamEvent,
  ProviderCapabilities,
  AgentStreamEvent,
} from '../llm/types.js';
import { WorkspaceDB } from '../workspace-db.js';
import { ToolRegistry } from '../tool-registry.js';
import { ContextAssembler } from '../context-assembler.js';
import { Consolidator } from '../consolidator.js';
import type { AgentRequest } from '../protocol.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ====== Mock LLM Provider ======

class MockLLMProvider implements LLMProvider {
  private responses: ChatResponse[] = [];
  private callIndex = 0;
  public chatCallCount = 0;
  public lastParams: ChatParams | null = null;

  setResponses(...responses: ChatResponse[]) {
    this.responses = responses;
    this.callIndex = 0;
    this.chatCallCount = 0;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    this.chatCallCount++;
    this.lastParams = params;
    return (
      this.responses[this.callIndex++] ?? {
        content: 'default response',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'end_turn' as const,
      }
    );
  }

  async *stream(params: ChatParams): AsyncIterable<LLMStreamEvent> {
    this.chatCallCount++;
    this.lastParams = params;
    const resp =
      this.responses[this.callIndex++] ?? {
        content: 'default response',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'end_turn' as const,
      };

    if (resp.content) {
      yield { type: 'text_delta', delta: resp.content };
    }

    for (const tc of resp.toolCalls) {
      yield {
        type: 'tool_use_start',
        toolCallId: tc.id,
        name: tc.name,
      };
      yield {
        type: 'tool_use_delta',
        toolCallId: tc.id,
        delta: JSON.stringify(tc.input),
      };
      yield { type: 'tool_use_end', toolCallId: tc.id };
    }

    yield {
      type: 'usage',
      usage: {
        inputTokens: resp.usage.inputTokens,
        outputTokens: resp.usage.outputTokens,
      },
    };
    yield { type: 'done', stopReason: resp.stopReason };
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      extendedThinking: false,
      promptCaching: false,
      vision: true,
      contextWindow: 200000,
      maxOutputTokens: 8192,
    };
  }
}

class MockLLMProviderNoCalling extends MockLLMProvider {
  override capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: false,
      extendedThinking: false,
      promptCaching: false,
      vision: true,
      contextWindow: 200000,
      maxOutputTokens: 8192,
    };
  }
}

// ====== Helpers ======

function makeRequest(
  sessionId: string,
  message: string,
): AgentRequest {
  return {
    method: 'run',
    params: {
      sessionId,
      message,
    },
  };
}

function collectEvents(callback: StreamCallback): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  return events;
}

function createStreamCollector(): {
  onStream: StreamCallback;
  events: AgentStreamEvent[];
} {
  const events: AgentStreamEvent[] = [];
  const onStream: StreamCallback = (event: AgentStreamEvent) => {
    events.push(event);
  };
  return { onStream, events };
}

// ====== Test Suite ======

describe('Agent Loop E2E', () => {
  let tmpDir: string;
  let db: WorkspaceDB;
  let toolRegistry: ToolRegistry;
  let assembler: ContextAssembler;
  let consolidator: Consolidator;
  let provider: MockLLMProvider;
  let sessionId: string;

  beforeEach(() => {
    // Create temp directory with workspace.db
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-e2e-'));
    const dbPath = path.join(tmpDir, 'workspace.db');
    db = new WorkspaceDB(dbPath);

    // Create a session
    const session = db.createSession({
      workspace_id: 'test-ws',
      user_id: 'test-user',
      title: 'E2E Test Session',
    });
    sessionId = session.id;

    // Set up tool registry with a simple echo tool
    toolRegistry = new ToolRegistry();
    toolRegistry.register({
      name: 'echo',
      description: 'Echoes back the input text',
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to echo' },
        },
        required: ['text'],
      },
      execute: async (input) => `echo: ${input.text}`,
    });

    // Set up context assembler (no skill loader, no bootstrap files)
    assembler = new ContextAssembler(db, null, toolRegistry, tmpDir);

    // Set up consolidator (no LLM callback)
    consolidator = new Consolidator(db, null);

    // Set up mock provider
    provider = new MockLLMProvider();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeDeps(overrides?: Partial<AgentDeps>): AgentDeps {
    return {
      provider,
      db,
      assembler,
      toolRegistry,
      consolidator,
      mcpManager: null,
      ...overrides,
    };
  }

  // ------------------------------------------------------------------
  // 1. Simple text response
  // ------------------------------------------------------------------
  describe('simple text response', () => {
    it('should return text and emit session_done', async () => {
      provider.setResponses({
        content: 'Hello, I am your assistant!',
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 20 },
        stopReason: 'end_turn',
      });

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Hi there');

      await runAgent(request, onStream, makeDeps());

      // Verify text_delta event was emitted
      const textEvents = events.filter((e) => e.type === 'text_delta');
      expect(textEvents.length).toBeGreaterThan(0);
      expect(
        textEvents.map((e) => ('delta' in e ? e.delta : '')).join(''),
      ).toBe('Hello, I am your assistant!');

      // Verify session_done event
      const doneEvents = events.filter((e) => e.type === 'session_done');
      expect(doneEvents).toHaveLength(1);
      const done = doneEvents[0] as { type: 'session_done'; usage: { inputTokens: number; outputTokens: number } };
      expect(done.usage.inputTokens).toBe(100);
      expect(done.usage.outputTokens).toBe(20);

      // Verify messages saved to DB
      const messages = db.getMessages(sessionId);
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe('Hi there');

      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe('Hello, I am your assistant!');
    });
  });

  // ------------------------------------------------------------------
  // 2. Tool call flow
  // ------------------------------------------------------------------
  describe('tool call flow', () => {
    it('should execute tool and return final text', async () => {
      // First response: tool call
      provider.setResponses(
        {
          content: 'Let me echo that for you.',
          toolCalls: [
            {
              id: 'tc_1',
              name: 'echo',
              input: { text: 'hello world' },
            },
          ],
          usage: { inputTokens: 100, outputTokens: 30 },
          stopReason: 'tool_use',
        },
        // Second response: final text after tool result
        {
          content: 'The echo returned: hello world',
          toolCalls: [],
          usage: { inputTokens: 150, outputTokens: 25 },
          stopReason: 'end_turn',
        },
      );

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Echo hello world');

      await runAgent(request, onStream, makeDeps());

      // Verify tool_result event was emitted
      const toolResults = events.filter((e) => e.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      const tr = toolResults[0] as { type: 'tool_result'; toolCallId: string; output: string };
      expect(tr.toolCallId).toBe('tc_1');
      expect(tr.output).toBe('echo: hello world');

      // Verify final text
      const textEvents = events.filter((e) => e.type === 'text_delta');
      const allText = textEvents.map((e) => ('delta' in e ? e.delta : '')).join('');
      expect(allText).toContain('The echo returned: hello world');

      // Verify session_done
      const doneEvents = events.filter((e) => e.type === 'session_done');
      expect(doneEvents).toHaveLength(1);
      const done = doneEvents[0] as { type: 'session_done'; usage: { inputTokens: number; outputTokens: number } };
      // Usage should be sum of both calls
      expect(done.usage.inputTokens).toBe(250);
      expect(done.usage.outputTokens).toBe(55);

      // Verify provider was called twice (once for tool call, once for final response)
      expect(provider.chatCallCount).toBe(2);

      // Verify messages in DB include tool results
      const messages = db.getMessages(sessionId);
      const toolMsgs = messages.filter((m) => m.role === 'tool');
      expect(toolMsgs).toHaveLength(1);
      expect(toolMsgs[0].content).toBe('echo: hello world');
    });
  });

  // ------------------------------------------------------------------
  // 3. Intent stop
  // ------------------------------------------------------------------
  describe('intent: stop', () => {
    it('should emit session_done immediately without LLM call', async () => {
      provider.setResponses({
        content: 'This should not be called',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'end_turn',
      });

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, '/stop');

      await runAgent(request, onStream, makeDeps());

      // Verify session_done emitted immediately
      const doneEvents = events.filter((e) => e.type === 'session_done');
      expect(doneEvents).toHaveLength(1);
      const done = doneEvents[0] as { type: 'session_done'; usage: { inputTokens: number; outputTokens: number } };
      expect(done.usage.inputTokens).toBe(0);
      expect(done.usage.outputTokens).toBe(0);

      // Verify no LLM call was made
      expect(provider.chatCallCount).toBe(0);

      // Verify no text events
      const textEvents = events.filter((e) => e.type === 'text_delta');
      expect(textEvents).toHaveLength(0);
    });

    it('should handle Chinese stop command', async () => {
      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, '停止');

      await runAgent(request, onStream, makeDeps());

      expect(events.filter((e) => e.type === 'session_done')).toHaveLength(1);
      expect(provider.chatCallCount).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // 4. Intent correction (/retry)
  // ------------------------------------------------------------------
  describe('intent: correction', () => {
    it('should start new agent loop on /retry', async () => {
      // First, send a normal message so there is history
      provider.setResponses(
        {
          content: 'First response',
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 10 },
          stopReason: 'end_turn',
        },
      );
      const { onStream: onStream1 } = createStreamCollector();
      await runAgent(makeRequest(sessionId, 'Hello'), onStream1, makeDeps());

      // Now send /retry - it should still invoke the agent loop
      // (correction intent falls through to 'continue' behavior in current code)
      provider.setResponses({
        content: 'Retried response',
        toolCalls: [],
        usage: { inputTokens: 60, outputTokens: 15 },
        stopReason: 'end_turn',
      });

      const { onStream: onStream2, events: events2 } = createStreamCollector();
      await runAgent(makeRequest(sessionId, '/retry'), onStream2, makeDeps());

      // Verify that the agent loop did run (correction falls through to continue)
      const textEvents = events2.filter((e) => e.type === 'text_delta');
      expect(textEvents.length).toBeGreaterThan(0);
      expect(
        textEvents.map((e) => ('delta' in e ? e.delta : '')).join(''),
      ).toBe('Retried response');

      // Verify session_done emitted
      const doneEvents = events2.filter((e) => e.type === 'session_done');
      expect(doneEvents).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------
  // 5. CLI mode (no function calling)
  // ------------------------------------------------------------------
  describe('CLI mode (toolUse=false)', () => {
    it('should parse tool calls from text and execute them', async () => {
      const cliProvider = new MockLLMProviderNoCalling();

      // First response: text containing a tool call in XML format
      cliProvider.setResponses(
        {
          content: 'Let me run that.\n<tool name="echo">{"text":"hi from CLI"}</tool>',
          toolCalls: [],
          usage: { inputTokens: 80, outputTokens: 20 },
          stopReason: 'end_turn', // CLI mode: stopReason will be overridden to tool_use by parseToolCallsFromText
        },
        // Second response: final text after tool result
        {
          content: 'Done! The echo said: hi from CLI',
          toolCalls: [],
          usage: { inputTokens: 120, outputTokens: 15 },
          stopReason: 'end_turn',
        },
      );

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Echo hi from CLI');

      await runAgent(request, onStream, makeDeps({ provider: cliProvider }));

      // Verify tool_result was emitted (tool was parsed from text and executed)
      const toolResults = events.filter((e) => e.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      const tr = toolResults[0] as { type: 'tool_result'; toolCallId: string; output: string };
      expect(tr.output).toBe('echo: hi from CLI');
      expect(tr.toolCallId).toMatch(/^cli_/);

      // Verify final text
      const textEvents = events.filter((e) => e.type === 'text_delta');
      const allText = textEvents.map((e) => ('delta' in e ? e.delta : '')).join('');
      expect(allText).toContain('Done! The echo said: hi from CLI');

      // Verify session_done
      expect(events.filter((e) => e.type === 'session_done')).toHaveLength(1);

      // Verify the provider was called twice
      expect(cliProvider.chatCallCount).toBe(2);
    });
  });

  // ------------------------------------------------------------------
  // 6. Consolidation trigger
  // ------------------------------------------------------------------
  describe('consolidation', () => {
    it('should run consolidation before context assembly (no stream event)', async () => {
      provider.setResponses({
        content: 'Simple response',
        toolCalls: [],
        usage: { inputTokens: 50, outputTokens: 10 },
        stopReason: 'end_turn',
      });

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Hello');

      await runAgent(request, onStream, makeDeps());

      // Consolidation now runs silently before context assembly, no stream event
      const consolidationEvents = events.filter((e) => e.type === 'consolidation');
      expect(consolidationEvents).toHaveLength(0);

      // session_done should still be emitted
      const doneEvents = events.filter((e) => e.type === 'session_done');
      expect(doneEvents).toHaveLength(1);
    });

    it('should trigger sliding window consolidation with many messages', async () => {
      // Use a small context window so consolidation triggers easily
      const smallConsolidator = new Consolidator(db, null, {
        contextWindowTokens: 500, // Very small window
      });

      // Fill the session with many messages to exceed 70% threshold
      for (let i = 0; i < 20; i++) {
        db.appendMessage({
          session_id: sessionId,
          role: 'user',
          content: `User message ${i}: ${'x'.repeat(50)}`,
        });
        db.appendMessage({
          session_id: sessionId,
          role: 'assistant',
          content: `Assistant response ${i}: ${'y'.repeat(50)}`,
        });
      }

      provider.setResponses({
        content: 'Final response after many messages',
        toolCalls: [],
        usage: { inputTokens: 200, outputTokens: 30 },
        stopReason: 'end_turn',
      });

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Continue');

      await runAgent(
        request,
        onStream,
        makeDeps({ consolidator: smallConsolidator }),
      );

      // Consolidation runs silently before context assembly
      const consolidationEvents = events.filter((e) => e.type === 'consolidation');
      expect(consolidationEvents).toHaveLength(0);

      // Verify session_done
      const doneEvents = events.filter((e) => e.type === 'session_done');
      expect(doneEvents).toHaveLength(1);

      // Verify that the session's last_consolidated was updated
      // (consolidator should have moved the window forward)
      const session = db.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.last_consolidated).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------
  // 7. ServerContext 传递
  // ------------------------------------------------------------------
  describe('serverContext', () => {
    it('should pass serverContext to assembler', async () => {
      provider.setResponses({
        content: 'Hello!',
        toolCalls: [],
        usage: { inputTokens: 50, outputTokens: 10 },
        stopReason: 'end_turn',
      });

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Hi');

      await runAgent(request, onStream, makeDeps({
        serverContext: {
          workspaceId: 'ws-test-123',
          workspaceName: 'Test Workspace',
          userPreferences: { customInstructions: '请用简体中文回复' },
        },
      }));

      // 验证 LLM 收到了自定义指令（通过 systemPrompt）
      expect(provider.lastParams?.systemPrompt).toContain('请用简体中文回复');

      // 验证 session_done 正常
      expect(events.filter((e) => e.type === 'session_done')).toHaveLength(1);
    });

    it('should fallback to empty serverContext when not provided', async () => {
      provider.setResponses({
        content: 'Hello!',
        toolCalls: [],
        usage: { inputTokens: 50, outputTokens: 10 },
        stopReason: 'end_turn',
      });

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Hi');

      // 不传 serverContext
      await runAgent(request, onStream, makeDeps());

      expect(events.filter((e) => e.type === 'session_done')).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------
  // Edge cases
  // ------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle no deps (echo fallback mode)', async () => {
      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'test message');

      await runAgent(request, onStream); // no deps

      const textEvents = events.filter((e) => e.type === 'text_delta');
      expect(textEvents).toHaveLength(1);
      expect((textEvents[0] as { type: 'text_delta'; delta: string }).delta).toBe(
        '[echo] test message',
      );

      expect(events.filter((e) => e.type === 'session_done')).toHaveLength(1);
    });

    it('should respect maxIterations limit', async () => {
      // Provider always returns tool calls, causing infinite loop
      const infiniteToolResponse: ChatResponse = {
        content: 'Calling tool again...',
        toolCalls: [{ id: 'tc_loop', name: 'echo', input: { text: 'loop' } }],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'tool_use',
      };

      // Set up many identical responses
      const manyResponses = Array.from({ length: 10 }, () => infiniteToolResponse);
      provider.setResponses(...manyResponses);

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Start loop');

      await runAgent(request, onStream, makeDeps({ maxIterations: 3 }));

      // Verify provider was called exactly maxIterations times
      expect(provider.chatCallCount).toBe(3);

      // Verify session_done was still emitted
      const doneEvents = events.filter((e) => e.type === 'session_done');
      expect(doneEvents).toHaveLength(1);
    });

    it('should handle unknown tool gracefully', async () => {
      provider.setResponses(
        {
          content: 'Calling unknown tool',
          toolCalls: [
            { id: 'tc_unknown', name: 'nonexistent_tool', input: {} },
          ],
          usage: { inputTokens: 50, outputTokens: 10 },
          stopReason: 'tool_use',
        },
        {
          content: 'Sorry, that tool does not exist.',
          toolCalls: [],
          usage: { inputTokens: 80, outputTokens: 15 },
          stopReason: 'end_turn',
        },
      );

      const { onStream, events } = createStreamCollector();
      const request = makeRequest(sessionId, 'Call unknown tool');

      await runAgent(request, onStream, makeDeps());

      // Verify tool_result contains error
      const toolResults = events.filter((e) => e.type === 'tool_result');
      expect(toolResults).toHaveLength(1);
      const tr = toolResults[0] as { type: 'tool_result'; output: string };
      expect(tr.output).toContain('Error: Unknown tool');

      // Still completes with session_done
      expect(events.filter((e) => e.type === 'session_done')).toHaveLength(1);
    });
  });
});
