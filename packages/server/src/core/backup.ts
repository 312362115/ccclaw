import { join } from 'node:path';
import { mkdir, readdir, stat, unlink, copyFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { logger } from '../logger.js';

const BACKUP_DIR = join(config.DATA_DIR, 'backups');
const MAIN_BACKUP_DIR = join(BACKUP_DIR, 'main');
const WS_BACKUP_DIR = join(BACKUP_DIR, 'workspaces');

// 保留天数
const MAIN_RETENTION_DAYS = 30;
const WS_RETENTION_DAYS = 14;

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** 确保备份目录存在 */
async function ensureDirs(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * 备份 SQLite 主库（使用 better-sqlite3 的 .backup() API）
 * 仅在 SQLite 模式下有效
 */
export async function backupMainDb(): Promise<string | null> {
  if (config.DB_DIALECT !== 'sqlite') {
    logger.info({ dialect: config.DB_DIALECT }, '非 SQLite 模式，跳过主库备份（请使用 pg_dump/mysqldump）');
    return null;
  }

  await ensureDirs([MAIN_BACKUP_DIR]);

  const srcPath = join(config.DATA_DIR, 'ccclaw.db');
  const destPath = join(MAIN_BACKUP_DIR, `ccclaw-${dateStamp()}.db`);

  try {
    const src = new Database(srcPath, { readonly: true });
    await src.backup(destPath);
    src.close();
    logger.info({ dest: destPath }, '主库备份完成');
    return destPath;
  } catch (err) {
    logger.error({ err }, '主库备份失败');
    throw err;
  }
}

/**
 * 备份所有 workspace.db
 * 遍历 DATA_DIR/workspaces/，对每个包含 internal/workspace.db 的目录执行备份
 */
export async function backupWorkspaceDbs(): Promise<string[]> {
  await ensureDirs([WS_BACKUP_DIR]);

  const wsRoot = join(config.DATA_DIR, 'workspaces');
  let slugs: string[];
  try {
    slugs = await readdir(wsRoot);
  } catch {
    logger.warn('工作区目录不存在，跳过 workspace.db 备份');
    return [];
  }

  const results: string[] = [];

  for (const slug of slugs) {
    const srcPath = join(wsRoot, slug, 'internal', 'workspace.db');
    try {
      await stat(srcPath);
    } catch {
      continue; // workspace.db 不存在，跳过
    }

    const destDir = join(WS_BACKUP_DIR, slug);
    await ensureDirs([destDir]);
    const destPath = join(destDir, `workspace-${dateStamp()}.db`);

    try {
      const src = new Database(srcPath, { readonly: true });
      await src.backup(destPath);
      src.close();

      // 同时备份 WAL 文件（如果存在）
      const walPath = srcPath + '-wal';
      try {
        await stat(walPath);
        await copyFile(walPath, destPath + '-wal');
      } catch {
        // WAL 不存在是正常的（可能已 checkpoint）
      }

      results.push(destPath);
    } catch (err) {
      logger.error({ slug, err }, 'workspace.db 备份失败');
    }
  }

  logger.info({ count: results.length }, 'workspace.db 备份完成');
  return results;
}

/**
 * 清理过期备份文件
 * @returns 删除的文件数量
 */
export async function pruneOldBackups(): Promise<number> {
  let deleted = 0;

  // 清理主库备份
  deleted += await pruneDir(MAIN_BACKUP_DIR, MAIN_RETENTION_DAYS);

  // 清理 workspace 备份
  try {
    const slugs = await readdir(WS_BACKUP_DIR);
    for (const slug of slugs) {
      deleted += await pruneDir(join(WS_BACKUP_DIR, slug), WS_RETENTION_DAYS);
    }
  } catch {
    // workspace 备份目录不存在
  }

  if (deleted > 0) {
    logger.info({ deleted }, '过期备份已清理');
  }

  return deleted;
}

async function pruneDir(dir: string, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 86400_000;
  let deleted = 0;

  try {
    const files = await readdir(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const fileStat = await stat(filePath);
        if (fileStat.isFile() && fileStat.mtimeMs < cutoff) {
          await unlink(filePath);
          deleted++;
        }
      } catch {
        // 单个文件删除失败不阻塞整体
      }
    }
  } catch {
    // 目录不存在
  }

  return deleted;
}

/**
 * 执行完整备份流程（主库 + workspace.db + 清理过期）
 * 供 Scheduler 或 CLI 调用
 */
export async function runFullBackup(): Promise<void> {
  const start = performance.now();
  logger.info('开始执行完整备份');

  await backupMainDb();
  await backupWorkspaceDbs();
  await pruneOldBackups();

  const ms = Math.round(performance.now() - start);
  logger.info({ duration: ms }, '完整备份流程完成');
}

/**
 * 列出所有可用备份
 */
export async function listBackups(): Promise<{ main: string[]; workspaces: Record<string, string[]> }> {
  const result: { main: string[]; workspaces: Record<string, string[]> } = {
    main: [],
    workspaces: {},
  };

  try {
    const mainFiles = await readdir(MAIN_BACKUP_DIR);
    result.main = mainFiles.filter(f => f.endsWith('.db')).sort().reverse();
  } catch {
    // 目录不存在
  }

  try {
    const slugs = await readdir(WS_BACKUP_DIR);
    for (const slug of slugs) {
      try {
        const files = await readdir(join(WS_BACKUP_DIR, slug));
        const dbFiles = files.filter(f => f.endsWith('.db') && !f.endsWith('-wal')).sort().reverse();
        if (dbFiles.length > 0) {
          result.workspaces[slug] = dbFiles;
        }
      } catch {
        // 单个工作区读取失败
      }
    }
  } catch {
    // 目录不存在
  }

  return result;
}

/**
 * 恢复主库备份
 * @param backupFile 备份文件名，如 ccclaw-2026-03-18.db
 */
export async function restoreMainDb(backupFile: string): Promise<void> {
  if (config.DB_DIALECT !== 'sqlite') {
    throw new Error('非 SQLite 模式，请使用 pg_restore/mysql 恢复');
  }

  const srcPath = join(MAIN_BACKUP_DIR, backupFile);
  const destPath = join(config.DATA_DIR, 'ccclaw.db');

  try {
    await stat(srcPath);
  } catch {
    throw new Error(`备份文件不存在: ${srcPath}`);
  }

  // 使用 better-sqlite3 的 backup 反向恢复
  const src = new Database(srcPath, { readonly: true });
  await src.backup(destPath);
  src.close();

  logger.info({ from: srcPath, to: destPath }, '主库恢复完成');
}

/**
 * 恢复指定工作区的 workspace.db
 * @param slug 工作区 slug
 * @param backupFile 备份文件名
 */
export async function restoreWorkspaceDb(slug: string, backupFile: string): Promise<void> {
  const srcPath = join(WS_BACKUP_DIR, slug, backupFile);
  const destPath = join(config.DATA_DIR, 'workspaces', slug, 'internal', 'workspace.db');

  try {
    await stat(srcPath);
  } catch {
    throw new Error(`备份文件不存在: ${srcPath}`);
  }

  const src = new Database(srcPath, { readonly: true });
  await src.backup(destPath);
  src.close();

  // 恢复 WAL 文件
  const walSrc = srcPath + '-wal';
  const walDest = destPath + '-wal';
  try {
    await stat(walSrc);
    await copyFile(walSrc, walDest);
  } catch {
    // WAL 备份不存在，尝试删除目标 WAL（避免不一致）
    try { await unlink(walDest); } catch { /* no-op */ }
  }

  logger.info({ slug, from: srcPath }, 'workspace.db 恢复完成');
}
