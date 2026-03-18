import { readFile, writeFile, mkdir, rm, stat as fsStat, access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validatePath, validatePathStrict } from '@ccclaw/shared';
import type { FileReadResult, FileCreateResult, FileDeleteResult, FileStatResult } from '@ccclaw/shared';

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
const BINARY_CHECK_BYTES = 8192;

export class FileError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'FileError';
  }
}

function isBinaryBuffer(buf: Buffer): boolean {
  const check = buf.subarray(0, BINARY_CHECK_BYTES);
  return check.includes(0);
}

export class FileHandler {
  constructor(private workspaceDir: string) {}

  async read(path: string): Promise<FileReadResult> {
    const resolved = await validatePathStrict(this.workspaceDir, path);

    let st;
    try {
      st = await fsStat(resolved);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new FileError('NOT_FOUND', `File not found: ${path}`);
      }
      throw new FileError('IO_ERROR', err.message);
    }

    if (st.size > MAX_FILE_SIZE) {
      throw new FileError('FILE_TOO_LARGE', `File exceeds 1MB limit: ${st.size} bytes`);
    }

    const buf = await readFile(resolved);
    const binary = isBinaryBuffer(buf);

    return {
      path,
      content: binary ? null : buf.toString('utf-8'),
      size: st.size,
      mtime: st.mtimeMs,
      binary,
    };
  }

  async create(path: string, type: 'file' | 'directory', content?: string): Promise<FileCreateResult> {
    const resolved = validatePath(this.workspaceDir, path);

    // Check if already exists
    try {
      await access(resolved, constants.F_OK);
      throw new FileError('ALREADY_EXISTS', `Already exists: ${path}`);
    } catch (err: any) {
      if (err instanceof FileError) throw err;
      // ENOENT is expected — path does not exist yet
      if (err.code !== 'ENOENT') {
        throw new FileError('IO_ERROR', err.message);
      }
    }

    if (type === 'directory') {
      await mkdir(resolved, { recursive: true });
    } else {
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content ?? '');
    }

    return { success: true, path };
  }

  async delete(path: string): Promise<FileDeleteResult> {
    const resolved = await validatePathStrict(this.workspaceDir, path);

    try {
      await access(resolved, constants.F_OK);
    } catch {
      throw new FileError('NOT_FOUND', `Not found: ${path}`);
    }

    await rm(resolved, { recursive: true, force: true });

    return { success: true, path };
  }

  async stat(path: string): Promise<FileStatResult> {
    const resolved = await validatePathStrict(this.workspaceDir, path);

    let st;
    try {
      st = await fsStat(resolved);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new FileError('NOT_FOUND', `Not found: ${path}`);
      }
      throw new FileError('IO_ERROR', err.message);
    }

    const type = st.isDirectory() ? 'directory' : 'file';
    let binary = false;
    if (type === 'file') {
      const buf = Buffer.alloc(Math.min(BINARY_CHECK_BYTES, st.size));
      // Read first bytes for binary check
      const { createReadStream } = await import('node:fs');
      binary = await new Promise<boolean>((resolve, reject) => {
        const stream = createReadStream(resolved, { start: 0, end: Math.min(BINARY_CHECK_BYTES, st.size) - 1 });
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(isBinaryBuffer(Buffer.concat(chunks))));
        stream.on('error', reject);
      });
    }

    return {
      path,
      type,
      size: st.size,
      mtime: st.mtimeMs,
      binary,
    };
  }
}
