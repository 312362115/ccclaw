/**
 * Feishu (Lark) Channel Adapter
 *
 * Enables users to chat with the AI agent via a Feishu bot.
 *
 * - Receives webhook events from Feishu (message subscription)
 * - Buffers streaming text_delta responses and sends a single reply on completion
 * - Handles URL verification challenge and webhook token verification
 * - Disabled by default when FEISHU_APP_ID is not set
 *
 * Env vars:
 *   FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_VERIFICATION_TOKEN
 *   FEISHU_DEFAULT_WORKSPACE_ID, FEISHU_DEFAULT_USER_ID
 */

import { Hono } from 'hono';
import { messageBus } from '../bus/instance.js';
import { nanoid } from '@ccclaw/shared';
import { logger } from '../logger.js';
import type { OutboundMessage } from '../bus/index.js';

// ====== Config ======
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN || '';
const FEISHU_DEFAULT_WORKSPACE_ID = process.env.FEISHU_DEFAULT_WORKSPACE_ID || '';
const FEISHU_DEFAULT_USER_ID = process.env.FEISHU_DEFAULT_USER_ID || '';

// ====== Feishu API Client ======

class FeishuClient {
  private token = '';
  private tokenExpiry = 0;

  async getToken(): Promise<string> {
    // Return cached token if still valid (with 60s margin)
    if (this.token && Date.now() < this.tokenExpiry - 60_000) {
      return this.token;
    }

    const res = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: FEISHU_APP_ID,
          app_secret: FEISHU_APP_SECRET,
        }),
      },
    );

    const data = (await res.json()) as {
      tenant_access_token: string;
      expire: number;
    };
    this.token = data.tenant_access_token;
    this.tokenExpiry = Date.now() + (data.expire || 7200) * 1000;
    return this.token;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body, chatId }, 'Feishu sendMessage failed');
    }
  }
}

// ====== Session Mapping ======
// chatId -> { workspaceId, sessionId }
const chatSessions = new Map<string, { workspaceId: string; sessionId: string }>();

// ====== Response Accumulator ======
// sessionId -> { chatId, buffer, toolInfo }
const pendingResponses = new Map<
  string,
  { chatId: string; buffer: string; toolInfo: string }
>();

// ====== Deduplication ======
// Track recently processed event_ids to handle Feishu's at-least-once delivery
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 1000;

function markEventProcessed(eventId: string): boolean {
  if (processedEvents.has(eventId)) return false;
  processedEvents.add(eventId);
  // Evict oldest entries when set grows too large
  if (processedEvents.size > MAX_PROCESSED_EVENTS) {
    const first = processedEvents.values().next().value;
    if (first !== undefined) processedEvents.delete(first);
  }
  return true;
}

// ====== Feishu Webhook Event Types ======

interface FeishuWebhookEvent {
  schema?: string;
  type?: string; // 'url_verification' for challenge
  challenge?: string;
  token?: string;
  header?: {
    event_id: string;
    event_type: string;
    token: string;
    create_time: string;
  };
  event?: {
    sender?: {
      sender_id?: { open_id?: string; user_id?: string };
      sender_type?: string;
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      content?: string;
      message_type?: string;
    };
  };
}

// ====== Create Channel ======

export function createFeishuChannel(): Hono | null {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    logger.info('Feishu channel disabled (FEISHU_APP_ID not set)');
    return null;
  }

  const client = new FeishuClient();
  const router = new Hono();

  router.post('/webhook', async (c) => {
    const body = (await c.req.json()) as FeishuWebhookEvent;

    // URL verification challenge
    if (body.type === 'url_verification') {
      return c.json({ challenge: body.challenge });
    }

    // Verify webhook token
    if (body.header?.token !== FEISHU_VERIFICATION_TOKEN) {
      return c.json({ error: 'Invalid token' }, 403);
    }

    // Only handle text messages
    if (body.header?.event_type !== 'im.message.receive_v1') {
      return c.json({ ok: true });
    }

    // Deduplicate (Feishu may retry delivery)
    const eventId = body.header.event_id;
    if (!markEventProcessed(eventId)) {
      return c.json({ ok: true });
    }

    const event = body.event;
    const chatId = event?.message?.chat_id;
    const messageType = event?.message?.message_type;

    if (!chatId || messageType !== 'text') {
      return c.json({ ok: true });
    }

    // Parse message content
    let content: string;
    try {
      const parsed = JSON.parse(event!.message!.content!) as { text?: string };
      content = parsed.text || '';
    } catch {
      return c.json({ ok: true });
    }

    if (!content.trim()) return c.json({ ok: true });

    // Get or create session for this chat
    let session = chatSessions.get(chatId);
    if (!session) {
      session = {
        workspaceId: FEISHU_DEFAULT_WORKSPACE_ID,
        sessionId: `feishu-${nanoid()}`,
      };
      chatSessions.set(chatId, session);
    }

    const { workspaceId, sessionId } = session;

    // Set up response accumulator
    pendingResponses.set(sessionId, { chatId, buffer: '', toolInfo: '' });

    // Subscribe to outbound messages for this session
    const handler = async (out: OutboundMessage) => {
      const pending = pendingResponses.get(sessionId);
      if (!pending) return;

      switch (out.type) {
        case 'text_delta':
          pending.buffer += out.content;
          break;

        case 'tool_use':
          pending.toolInfo += `\n[Tool: ${out.tool}]`;
          break;

        case 'tool_result':
          pending.toolInfo += `\n[Result: ${(out.output || '').slice(0, 200)}]`;
          break;

        case 'error':
        case 'done': {
          // Unsubscribe first
          messageBus.offSessionOutbound(sessionId, handler);

          let text = pending.buffer.trim();
          if (out.type === 'error') {
            text = `Error: ${out.message || 'Unknown error'}`;
          }
          if (!text && pending.toolInfo) {
            text = pending.toolInfo.trim();
          }

          if (text) {
            await client.sendMessage(pending.chatId, text).catch((err) => {
              logger.error({ err, chatId: pending.chatId }, 'Feishu send failed');
            });
          }

          pendingResponses.delete(sessionId);
          break;
        }

        default:
          break;
      }
    };

    messageBus.onSessionOutbound(sessionId, handler);

    // Publish inbound message to bus
    messageBus.publishInbound({
      type: 'user_message',
      workspaceId,
      sessionId,
      userId: FEISHU_DEFAULT_USER_ID,
      channelType: 'feishu',
      content,
    });

    // Respond immediately to Feishu (webhook must reply within 3s)
    return c.json({ ok: true });
  });

  logger.info('Feishu channel enabled');
  return router;
}
