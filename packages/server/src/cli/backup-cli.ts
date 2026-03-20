#!/usr/bin/env node
/**
 * 备份/恢复 CLI 工具
 *
 * 用法:
 *   npx tsx packages/server/src/cli/backup-cli.ts backup          # 执行完整备份
 *   npx tsx packages/server/src/cli/backup-cli.ts list            # 列出可用备份
 *   npx tsx packages/server/src/cli/backup-cli.ts restore-main <文件名>         # 恢复主库
 *   npx tsx packages/server/src/cli/backup-cli.ts restore-workspace <slug> <文件名>  # 恢复工作区
 */

import {
  runFullBackup,
  listBackups,
  restoreMainDb,
  restoreWorkspaceDb,
} from '../core/backup.js';

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case 'backup': {
      console.log('开始执行完整备份...');
      await runFullBackup();
      console.log('备份完成');
      break;
    }

    case 'list': {
      const backups = await listBackups();
      console.log('\n=== 主库备份 ===');
      if (backups.main.length === 0) {
        console.log('  （无）');
      } else {
        for (const f of backups.main) console.log(`  ${f}`);
      }

      console.log('\n=== 工作区备份 ===');
      const slugs = Object.keys(backups.workspaces);
      if (slugs.length === 0) {
        console.log('  （无）');
      } else {
        for (const slug of slugs) {
          console.log(`  [${slug}]`);
          for (const f of backups.workspaces[slug]) console.log(`    ${f}`);
        }
      }
      console.log('');
      break;
    }

    case 'restore-main': {
      const file = args[0];
      if (!file) {
        console.error('用法: restore-main <备份文件名>');
        console.error('示例: restore-main ccclaw-2026-03-18.db');
        process.exit(1);
      }
      console.log(`正在恢复主库: ${file}`);
      await restoreMainDb(file);
      console.log('主库恢复完成，请重启服务');
      break;
    }

    case 'restore-workspace': {
      const [slug, file] = args;
      if (!slug || !file) {
        console.error('用法: restore-workspace <slug> <备份文件名>');
        console.error('示例: restore-workspace my-project workspace-2026-03-18.db');
        process.exit(1);
      }
      console.log(`正在恢复工作区 ${slug}: ${file}`);
      await restoreWorkspaceDb(slug, file);
      console.log('workspace.db 恢复完成，请重启对应 Runner');
      break;
    }

    default:
      console.log(`CCCLaw 备份/恢复工具

用法:
  backup                                    执行完整备份（主库 + 所有 workspace.db）
  list                                      列出所有可用备份
  restore-main <文件名>                     恢复主库备份
  restore-workspace <slug> <文件名>         恢复指定工作区的 workspace.db

示例:
  npx tsx packages/server/src/cli/backup-cli.ts backup
  npx tsx packages/server/src/cli/backup-cli.ts list
  npx tsx packages/server/src/cli/backup-cli.ts restore-main ccclaw-2026-03-18.db
  npx tsx packages/server/src/cli/backup-cli.ts restore-workspace my-ws workspace-2026-03-18.db`);
      break;
  }
}

main().catch((err) => {
  console.error('执行失败:', err);
  process.exit(1);
});
