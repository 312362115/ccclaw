import { resolve } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

/**
 * 安全校验：确保路径在工作区范围内
 */
export function validatePath(basePath: string, userPath: string): string {
  const base = resolve(basePath);
  const resolved = resolve(basePath, userPath);
  // Strict prefix check: prevent /workspace-evil matching /workspace
  if (resolved !== base && !resolved.startsWith(base + '/')) {
    throw new Error('路径越界：禁止访问工作区外的文件');
  }
  return resolved;
}

/**
 * 安全校验（含符号链接检查）
 */
export async function validatePathStrict(basePath: string, userPath: string): Promise<string> {
  const base = resolve(basePath);
  const resolved = resolve(basePath, userPath);
  if (resolved !== base && !resolved.startsWith(base + '/')) {
    throw new Error('路径越界：禁止访问工作区外的文件');
  }
  try {
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink()) {
      const real = await realpath(resolved);
      const realBase = await realpath(base);
      if (!real.startsWith(realBase + '/') && real !== realBase) {
        throw new Error('符号链接指向工作区外：拒绝访问');
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  return resolved;
}
