import { mkdir, chmod, lstat, realpath, cp, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function initWorkspaceStorage(slug: string, gitRepo?: string | null, gitToken?: string | null) {
  const base = join(config.DATA_DIR, 'workspaces', slug);
  const workDir = join(base, 'workspace');
  const skillsDir = join(base, 'skills');
  await mkdir(workDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  // 目录权限：owner 读写执行
  await chmod(base, 0o700);

  // 初始化 workspace.db（SQLite + WAL，包含 sessions + messages + memories）
  const wsDbPath = join(base, 'workspace.db');
  const wsDb = new Database(wsDbPath);
  wsDb.pragma('journal_mode = WAL');
  wsDb.pragma('foreign_keys = ON');
  wsDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_type TEXT NOT NULL DEFAULT 'webui',
      title TEXT NOT NULL DEFAULT '新会话',
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('project','reference','decision','feedback','log')),
      content TEXT NOT NULL,
      embedding BLOB,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
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
    await execFileAsync('git', ['clone', cloneUrl, '.'], { cwd: workDir });
  }
}

export async function initGlobalStorage() {
  await mkdir(join(config.DATA_DIR, 'backups'), { recursive: true });
}

export function getWorkspacePaths(slug: string) {
  const base = join(config.DATA_DIR, 'workspaces', slug);
  return {
    base,
    workspace: join(base, 'workspace'),
    memory: join(base, 'memory'),
    skills: join(base, 'skills'),
  };
}

// 安全校验：确保路径在工作区范围内
export function validatePath(basePath: string, userPath: string): string {
  const resolved = resolve(basePath, userPath);
  if (!resolved.startsWith(basePath)) {
    throw new Error('路径越界：禁止访问工作区外的文件');
  }
  return resolved;
}

// 安全校验（含符号链接检查）
export async function validatePathStrict(basePath: string, userPath: string): Promise<string> {
  const resolved = resolve(basePath, userPath);
  if (!resolved.startsWith(basePath)) {
    throw new Error('路径越界：禁止访问工作区外的文件');
  }

  try {
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink()) {
      const real = await realpath(resolved);
      if (!real.startsWith(basePath)) {
        throw new Error('符号链接指向工作区外：拒绝访问');
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  return resolved;
}

// 构建子进程最小环境变量（防止泄露主服务密钥）
export function buildSafeEnv(workspaceSlug: string): Record<string, string> {
  const paths = getWorkspacePaths(workspaceSlug);
  return {
    NODE_ENV: process.env.NODE_ENV || 'production',
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    SOCKET_PATH: join(paths.base, 'agent.sock'),
    WORKSPACE_DIR: paths.workspace,
    ALLOWED_PATHS: [paths.workspace, paths.memory, paths.skills].join(':'),
  };
}
