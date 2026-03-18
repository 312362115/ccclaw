import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileHandler, FileError } from './file-handler.js';

describe('FileHandler', () => {
  let tmpDir: string;
  let handler: FileHandler;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-test-'));
    handler = new FileHandler(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- read ---

  it('should read a text file', async () => {
    await writeFile(join(tmpDir, 'hello.txt'), 'world');
    const result = await handler.read('hello.txt');
    expect(result.content).toBe('world');
    expect(result.binary).toBe(false);
    expect(result.size).toBe(5);
    expect(result.path).toBe('hello.txt');
  });

  it('should detect binary file', async () => {
    const buf = Buffer.alloc(100);
    buf[50] = 0; // null byte
    buf.write('hello', 0);
    await writeFile(join(tmpDir, 'binary.bin'), buf);
    const result = await handler.read('binary.bin');
    expect(result.binary).toBe(true);
    expect(result.content).toBeNull();
  });

  it('should reject file larger than 1MB', async () => {
    const big = Buffer.alloc(1024 * 1024 + 1, 'a');
    await writeFile(join(tmpDir, 'big.txt'), big);
    try {
      await handler.read('big.txt');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FileError);
      expect((err as FileError).code).toBe('FILE_TOO_LARGE');
    }
  });

  // --- create ---

  it('should create a new file', async () => {
    const result = await handler.create('newfile.txt', 'file', 'content here');
    expect(result.success).toBe(true);
    // Verify file exists by reading it
    const read = await handler.read('newfile.txt');
    expect(read.content).toBe('content here');
  });

  it('should create a new directory', async () => {
    const result = await handler.create('newdir', 'directory');
    expect(result.success).toBe(true);
    const stat = await handler.stat('newdir');
    expect(stat.type).toBe('directory');
  });

  it('should reject creating existing file', async () => {
    await writeFile(join(tmpDir, 'exists.txt'), 'already here');
    try {
      await handler.create('exists.txt', 'file', 'new');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FileError);
      expect((err as FileError).code).toBe('ALREADY_EXISTS');
    }
  });

  // --- delete ---

  it('should delete a file', async () => {
    await writeFile(join(tmpDir, 'to-delete.txt'), 'bye');
    const result = await handler.delete('to-delete.txt');
    expect(result.success).toBe(true);
    // Verify it's gone
    try {
      await handler.read('to-delete.txt');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FileError);
      expect((err as FileError).code).toBe('NOT_FOUND');
    }
  });

  it('should delete directory recursively', async () => {
    await mkdir(join(tmpDir, 'dir', 'sub'), { recursive: true });
    await writeFile(join(tmpDir, 'dir', 'sub', 'file.txt'), 'nested');
    const result = await handler.delete('dir');
    expect(result.success).toBe(true);
    try {
      await handler.stat('dir');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FileError);
      expect((err as FileError).code).toBe('NOT_FOUND');
    }
  });

  // --- stat ---

  it('should stat a file', async () => {
    await writeFile(join(tmpDir, 'info.txt'), 'metadata');
    const result = await handler.stat('info.txt');
    expect(result.path).toBe('info.txt');
    expect(result.type).toBe('file');
    expect(result.size).toBe(8);
    expect(result.binary).toBe(false);
    expect(typeof result.mtime).toBe('number');
  });

  // --- path validation ---

  it('should reject path outside workspace', async () => {
    await expect(handler.read('../../etc/passwd')).rejects.toThrow();
  });
});
