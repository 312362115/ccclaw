/**
 * HeartbeatService — 自主唤醒服务
 *
 * 周期扫描启用了 heartbeat 的工作区，读取 HEARTBEAT.md，
 * 通过 LLM 决策是否需要执行任务。
 */

import cron from 'node-cron';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../logger.js';
import { agentManager } from './agent-manager.js';
import { nanoid } from '@ccclaw/shared';

let cronJob: cron.ScheduledTask | null = null;

export interface HeartbeatConfig {
  /** cron 表达式，默认每 30 分钟 */
  schedule?: string;
  enabled?: boolean;
}

/**
 * 启动 Heartbeat 服务
 * 默认每 30 分钟扫描一次
 */
export function startHeartbeat(config: HeartbeatConfig = {}) {
  if (config.enabled === false) {
    logger.info('Heartbeat service disabled');
    return;
  }

  const schedule = config.schedule ?? '*/30 * * * *';

  cronJob = cron.schedule(schedule, async () => {
    try {
      await scanHeartbeats();
    } catch (err) {
      logger.error(err, 'Heartbeat 扫描失败');
    }
  });

  logger.info({ schedule }, 'Heartbeat service started');
}

export function stopHeartbeat() {
  cronJob?.stop();
  cronJob = null;
}

/**
 * 扫描所有启用 heartbeat 的工作区
 */
async function scanHeartbeats() {
  // 查询 settings 中包含 heartbeat 配置的工作区
  const workspaces = await db.select().from(schema.workspaces);

  for (const ws of workspaces) {
    const settings = (ws.settings as Record<string, unknown>) || {};
    if (!settings.heartbeatEnabled) continue;

    const heartbeatPrompt = (settings.heartbeatPrompt as string) || '';
    if (!heartbeatPrompt.trim()) continue;

    try {
      await executeHeartbeat(ws.id, ws.createdBy, heartbeatPrompt);
    } catch (err) {
      logger.error({ workspaceId: ws.id, error: String(err) }, 'Heartbeat 执行失败');
    }
  }
}

/**
 * 执行单个工作区的 heartbeat
 * 创建临时 Session，通过 AgentManager 执行
 */
async function executeHeartbeat(
  workspaceId: string,
  userId: string,
  prompt: string,
) {
  const sessionId = `heartbeat-${nanoid()}`;

  // 包装 heartbeat prompt：让 LLM 决定是否需要执行
  const wrappedPrompt = [
    '[Heartbeat 自动唤醒]',
    '',
    '以下是工作区的 heartbeat 规则。请判断当前是否需要执行操作。',
    '如果不需要执行，只回复 "[SKIP]" 即可。',
    '如果需要执行，直接开始工作。',
    '',
    '---',
    prompt,
  ].join('\n');

  await agentManager.chat(
    workspaceId,
    userId,
    sessionId,
    wrappedPrompt,
    {
      onDelta: () => { /* heartbeat 不需要流式输出 */ },
      onDone: () => {
        logger.info({ workspaceId, sessionId }, 'Heartbeat 执行完成');
      },
      onError: (msg) => {
        logger.error({ workspaceId, error: msg.message }, 'Heartbeat Agent 错误');
      },
    },
  );
}
