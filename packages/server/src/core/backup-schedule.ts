import cron from 'node-cron';
import { logger } from '../logger.js';
import { runFullBackup } from './backup.js';
import { cleanExpiredTokenUsage, vacuumIfSqlite } from './data-retention.js';

let backupJob: cron.ScheduledTask | null = null;

/**
 * 启动自动备份调度（每日凌晨 2 点）
 * 备份完成后执行 token_usage 清理和 VACUUM
 */
export function startBackupSchedule() {
  backupJob = cron.schedule('0 2 * * *', async () => {
    try {
      await runFullBackup();
      await cleanExpiredTokenUsage(90);
      await vacuumIfSqlite();
    } catch (err) {
      logger.error({ err }, '自动备份/清理任务失败');
    }
  });

  logger.info('自动备份调度已启动（每日 02:00）');
}

export function stopBackupSchedule() {
  backupJob?.stop();
  backupJob = null;
}
