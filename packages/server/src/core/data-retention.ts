import { db, schema, dialect } from '../db/index.js';
import { lt } from 'drizzle-orm';
import { logger } from '../logger.js';

/**
 * 清理超过指定天数的 token_usage 原始记录
 * @returns 删除的行数
 */
export async function cleanExpiredTokenUsage(retentionDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();

  try {
    const result = await db.delete(schema.tokenUsage)
      .where(lt(schema.tokenUsage.createdAt, cutoff));

    // Drizzle 不同方言返回格式不同，兼容处理
    const count = typeof result === 'object' && result !== null
      ? (result as any).rowsAffected ?? (result as any).changes ?? 0
      : 0;

    if (count > 0) {
      logger.info({ deleted: count, retentionDays }, 'token_usage 过期数据已清理');
    }

    return count;
  } catch (err) {
    logger.error({ err, retentionDays }, 'token_usage 清理失败');
    return 0;
  }
}

/**
 * SQLite VACUUM（仅 SQLite 模式）
 * 在大量删除后回收磁盘空间
 */
export async function vacuumIfSqlite(): Promise<void> {
  if (dialect !== 'sqlite') return;

  try {
    // Drizzle 不直接支持 VACUUM，通过 run 执行原始 SQL
    (db as any).run?.('VACUUM') ?? (db as any).$client?.exec?.('VACUUM');
    logger.info('SQLite VACUUM 完成');
  } catch (err) {
    logger.error({ err }, 'SQLite VACUUM 失败');
  }
}
