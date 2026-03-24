import { mkdir, chmod, cp, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { validatePath, validatePathStrict } from '@ccclaw/shared';
export { validatePath, validatePathStrict };

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function initWorkspaceStorage(slug: string, gitRepo?: string | null, gitToken?: string | null) {
  const base = join(config.DATA_DIR, 'workspaces', slug);
  const homeDir = join(base, 'home');
  const internalDir = join(base, 'internal');
  const skillsDir = join(internalDir, 'skills');
  const skillCacheDir = join(internalDir, 'skill-cache');
  await mkdir(homeDir, { recursive: true });
  await mkdir(internalDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });
  await mkdir(skillCacheDir, { recursive: true });

  // 目录权限：owner 读写执行
  await chmod(base, 0o700);

  // 初始化 workspace.db（SQLite + WAL）
  // WorkspaceDB 类（agent-runtime）负责完整 schema，此处仅确保文件可创建
  const wsDbPath = join(internalDir, 'workspace.db');
  const wsDb = new Database(wsDbPath);
  wsDb.pragma('journal_mode = WAL');
  wsDb.pragma('foreign_keys = ON');
  wsDb.close();

  // 复制系统预置 Skill 到工作区
  const presetDir = join(__dirname, '..', 'skills');
  try {
    const files = await readdir(presetDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        await cp(join(presetDir, file), join(skillsDir, file));
      }
    }
  } catch {
    // 预置 Skill 目录不存在时跳过
  }

  if (gitRepo) {
    let cloneUrl = gitRepo;
    if (gitToken) {
      const url = new URL(gitRepo);
      url.username = 'oauth2';
      url.password = gitToken;
      cloneUrl = url.toString();
    }
    await execFileAsync('git', ['clone', cloneUrl, '.'], { cwd: homeDir });
  }
}

export async function initGlobalStorage() {
  await mkdir(join(config.DATA_DIR, 'backups'), { recursive: true });
}

export function getWorkspacePaths(slug: string) {
  const base = join(config.DATA_DIR, 'workspaces', slug);
  return {
    base,
    home: join(base, 'home'),
    internal: join(base, 'internal'),
    skills: join(base, 'internal', 'skills'),
    wsDb: join(base, 'internal', 'workspace.db'),
  };
}

export async function removeWorkspaceStorage(slug: string) {
  const base = join(config.DATA_DIR, 'workspaces', slug);
  await rm(base, { recursive: true, force: true });
}

// 构建子进程最小环境变量（防止泄露主服务密钥）
export function buildSafeEnv(workspaceSlug: string): Record<string, string> {
  const paths = getWorkspacePaths(workspaceSlug);
  return {
    NODE_ENV: process.env.NODE_ENV || 'production',
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    SHELL: process.env.SHELL || '/bin/bash',
    TERM: process.env.TERM || 'xterm-256color',
    LANG: process.env.LANG || 'en_US.UTF-8',
    SOCKET_PATH: join(paths.base, 'agent.sock'),
    WORKSPACE_DIR: paths.home,
    INTERNAL_DIR: paths.internal,
    WORKSPACE_DB: paths.wsDb,
    ALLOWED_PATHS: [paths.home, paths.skills, paths.wsDb].join(':'),
  };
}
