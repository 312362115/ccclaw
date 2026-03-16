// 定时任务调度器 — node-cron + p-queue
import cron from 'node-cron';
import PQueue from 'p-queue';
import { db, schema } from '../db/index.js';
import { eq, and, lte } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { agentManager } from './agent-manager.js';
import { nanoid } from '@ccclaw/shared';

const queue = new PQueue({ concurrency: config.SCHEDULER_CONCURRENCY });

let cronJob: cron.ScheduledTask | null = null;

/**
 * 启动调度器：每分钟扫描一次到期任务
 */
export function startScheduler() {
  cronJob = cron.schedule('* * * * *', async () => {
    try {
      await scanAndDispatch();
    } catch (err) {
      logger.error(err, '调度器扫描失败');
    }
  });
  logger.info('Scheduler started');
}

export function stopScheduler() {
  cronJob?.stop();
  cronJob = null;
}

/**
 * 扫描到期任务并入队执行
 */
async function scanAndDispatch() {
  const now = new Date();

  const tasks = await db.select().from(schema.scheduledTasks).where(
    and(
      eq(schema.scheduledTasks.enabled, true),
      lte(schema.scheduledTasks.nextRunAt, now),
    ),
  );

  for (const task of tasks) {
    queue.add(() => executeTask(task)).catch((err) => {
      logger.error({ taskId: task.id, error: String(err) }, '任务执行失败');
    });
  }
}

/**
 * 执行单个定时任务
 */
async function executeTask(task: any) {
  const sessionId = `sched-${nanoid()}`;
  const runId = nanoid();

  // 记录 task_run
  await db.insert(schema.taskRuns).values({
    id: runId,
    taskId: task.id,
    sessionId,
    status: 'running',
  } as any);

  try {
    // 获取工作区信息
    const [workspace] = await db.select().from(schema.workspaces)
      .where(eq(schema.workspaces.id, task.workspaceId)).limit(1);

    if (!workspace) {
      throw new Error(`工作区 ${task.workspaceId} 不存在`);
    }

    // 调用 AgentManager 执行任务
    await agentManager.chat(
      task.workspaceId,
      workspace.createdBy,
      sessionId,
      task.prompt,
      {
        onDelta: () => { /* 定时任务不需要流式输出 */ },
        onDone: () => { /* done */ },
        onError: (msg) => {
          logger.error({ taskId: task.id, error: msg.message }, '定时任务 Agent 错误');
        },
      },
    );

    // 更新 task_run 状态
    await db.update(schema.taskRuns)
      .set({ status: 'success', finishedAt: new Date() } as any)
      .where(eq(schema.taskRuns.id, runId));

    logger.info({ taskId: task.id, runId }, '定时任务执行成功');
  } catch (err) {
    await db.update(schema.taskRuns)
      .set({ status: 'failed', finishedAt: new Date(), error: String(err) } as any)
      .where(eq(schema.taskRuns.id, runId));

    logger.error({ taskId: task.id, runId, error: String(err) }, '定时任务执行失败');
  }

  // 计算下次执行时间
  await updateNextRunAt(task);
}

/**
 * 根据 cron 表达式计算下次执行时间
 */
async function updateNextRunAt(task: any) {
  try {
    const interval = cron.validate(task.cron) ? getNextCronDate(task.cron) : null;
    await db.update(schema.scheduledTasks)
      .set({
        lastRunAt: new Date(),
        nextRunAt: interval,
      } as any)
      .where(eq(schema.scheduledTasks.id, task.id));
  } catch (err) {
    logger.error({ taskId: task.id, error: String(err) }, '更新下次执行时间失败');
  }
}

/**
 * 简单的 cron 下次执行时间计算
 */
function getNextCronDate(cronExpr: string): Date {
  // 使用 node-cron 的内部机制获取下次执行时间
  // 简化实现：下一分钟
  const next = new Date();
  next.setMinutes(next.getMinutes() + 1);
  next.setSeconds(0);
  next.setMilliseconds(0);
  return next;
}
