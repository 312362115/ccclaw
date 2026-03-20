import { useEffect, useRef, useCallback } from 'react';
import { DirectWsClient } from '../api/direct-ws';
import { useFileTreeStore } from '../stores/file-tree';
import { useChatStore } from '../stores/chat';

export function useDirectConnection(workspaceId: string | null) {
  const clientRef = useRef<DirectWsClient | null>(null);
  const store = useFileTreeStore;

  useEffect(() => {
    if (!workspaceId) return;

    const client = new DirectWsClient({
      workspaceId,
      onStateChange: (state) => {
        store.getState().setConnectionState(state);

        // When DIRECT or TUNNEL, set the directSend on chat store; clear it otherwise
        if (state === 'DIRECT' || state === 'TUNNEL') {
          useChatStore.getState().setDirectSend((msg: unknown) => {
            client.send(msg).catch((err: unknown) => {
              console.error('[DirectConnection] Failed to send chat message via direct channel', err);
            });
          });
        } else {
          useChatStore.getState().setDirectSend(null);
        }
      },
      onMessage: (msg) => {
        const s = store.getState();

        // ── Tree events ────────────────────────────────────────────────
        if (msg.channel === 'tree') {
          if (msg.action === 'snapshot') {
            if (msg.data.path === '/') {
              s.setEntries(msg.data.entries, msg.data.truncated);
            } else {
              s.mergeSubtree(msg.data.path, msg.data.entries);
            }
          } else if (msg.action === 'event') {
            s.applyEvents(msg.data.events);
          }
        }

        // ── File events ────────────────────────────────────────────────
        else if (msg.channel === 'file') {
          if (msg.action === 'read_result') {
            s.setPreview(msg.data.path, msg.data.content, msg.data.binary);
          }
          // create_result / delete_result handled by tree:event auto-push
        }

        // ── Chat events ────────────────────────────────────────────────
        else if (msg.channel === 'chat') {
          const chatStore = useChatStore.getState();
          const event = msg.data as Record<string, unknown>;
          const sessionId = (chatStore.currentSessionId ?? '') as string;

          switch (msg.action) {
            case 'text_delta': {
              const text = (event.delta as string) || (event.content as string) || '';
              const newBufferMap = new Map(chatStore.streamBufferMap);
              newBufferMap.set(sessionId, (newBufferMap.get(sessionId) ?? '') + text);
              useChatStore.setState({ streamBufferMap: newBufferMap });
              break;
            }

            case 'tool_use_start': {
              const toolId = (event.toolCallId as string) || (event.toolId as string) || '';
              const name = (event.name as string) || '';
              chatStore.onToolUseStart(sessionId, toolId, name);
              break;
            }

            case 'tool_use_delta': {
              const toolId = (event.toolCallId as string) || (event.toolId as string) || '';
              const delta = (event.delta as string) || '';
              chatStore.onToolUseDelta(sessionId, toolId, delta);
              break;
            }

            case 'tool_use_end': {
              const toolId = (event.toolCallId as string) || (event.toolId as string) || '';
              chatStore.onToolUseEnd(sessionId, toolId);
              break;
            }

            case 'tool_result': {
              const toolId = (event.toolCallId as string) || (event.toolId as string) || '';
              const output = (event.output as string) || '';
              chatStore.onToolResult(sessionId, toolId, output);
              break;
            }

            case 'thinking_delta': {
              const content = (event.delta as string) || (event.content as string) || '';
              chatStore.onThinkingDelta(sessionId, content);
              break;
            }

            case 'consolidation': {
              const summary = (event.summary as string) || (event.message as string) || '';
              chatStore.onConsolidation(sessionId, summary);
              break;
            }

            case 'plan_mode': {
              chatStore.onPlanMode(sessionId, (event.active as boolean) ?? false);
              break;
            }

            case 'subagent_started': {
              const label = (event.goal as string) || (event.subagentId as string) || '';
              chatStore.onConsolidation(sessionId, `[子 Agent 启动] ${label}`);
              break;
            }

            case 'subagent_result': {
              const subId = (event.subagentId as string) || '';
              const result = (event.result as string) || '';
              chatStore.onConsolidation(sessionId, `[子 Agent 完成] ${subId}: ${result}`);
              break;
            }

            case 'session_done': {
              const usage = event.usage as { inputTokens: number; outputTokens: number } | undefined;
              const tokens = usage ?? { inputTokens: 0, outputTokens: 0 };
              chatStore.onSessionDone(sessionId, tokens);
              break;
            }

            case 'done': {
              // Legacy done event
              const usage = event.usage as { inputTokens: number; outputTokens: number } | undefined;
              const tokens = usage ?? { inputTokens: 0, outputTokens: 0 };
              chatStore.onSessionDone(sessionId, tokens);
              break;
            }

            case 'confirm_request': {
              const requestId = (event.confirmId as string) || (event.requestId as string) || '';
              const toolName = (event.toolName as string) || (event.name as string) || '';
              const input = event.input;
              const reason = (event.reason as string) || '';
              chatStore.onConfirmRequest(sessionId, requestId, toolName, input, reason);
              break;
            }

            case 'error': {
              const errorMsg = (event.message as string) || '未知错误';
              const s = useChatStore.getState();
              const newErrorMap = new Map(s.streamErrorMap);
              newErrorMap.set(sessionId, errorMsg);
              const newStreamingMap = new Map(s.streamingMap);
              newStreamingMap.set(sessionId, false);
              const newBufferMap = new Map(s.streamBufferMap);
              newBufferMap.set(sessionId, '');
              useChatStore.setState({ streamErrorMap: newErrorMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap });
              break;
            }

            default:
              break;
          }
        }
      },
    });

    clientRef.current = client;

    // Connect and request initial tree
    client
      .connect()
      .then(() => {
        client.send({
          channel: 'tree',
          action: 'list',
          requestId: 'init-' + Date.now(),
          data: { path: '/', depth: 2 },
        });
      })
      .catch(() => {
        // Fallback to RELAY — DirectWsClient handles this internally
      });

    return () => {
      client.disconnect();
      clientRef.current = null;
      // Clear directSend on unmount
      useChatStore.getState().setDirectSend(null);
    };
  }, [workspaceId]);

  const sendDirectMessage = useCallback((msg: any) => {
    clientRef.current?.send(msg);
  }, []);

  return { sendDirectMessage };
}
