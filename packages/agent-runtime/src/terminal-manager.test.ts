import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalManager } from './terminal-manager.js';

// Mock node-pty
vi.mock('node-pty', () => {
  const mockPty = {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };

  return {
    spawn: vi.fn(() => mockPty),
    _mockPty: mockPty,
  };
});

function getMockPty() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (vi.mocked(require('node-pty')) as any)._mockPty;
}

// Helper to get fresh mocks after each mock reset
import * as nodePty from 'node-pty';

function getSpawnMock() {
  return vi.mocked(nodePty.spawn);
}

function getLastPty() {
  const calls = getSpawnMock().mock.results;
  if (calls.length === 0) throw new Error('spawn was not called');
  return calls[calls.length - 1].value as {
    onData: ReturnType<typeof vi.fn>;
    onExit: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };
}

describe('TerminalManager', () => {
  let onOutput: ReturnType<typeof vi.fn>;
  let onExit: ReturnType<typeof vi.fn>;
  let manager: TerminalManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    onOutput = vi.fn();
    onExit = vi.fn();

    manager = new TerminalManager({
      workspaceDir: '/workspace',
      maxSessions: 2,
      idleTimeoutMs: 5000,
      onOutput,
      onExit,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.closeAll();
  });

  it('open creates a session and returns true', () => {
    const result = manager.open('t1', 80, 24);
    expect(result).toBe(true);
    expect(getSpawnMock()).toHaveBeenCalledOnce();
    expect(manager.getActiveCount()).toBe(1);
  });

  it('open returns true if session already exists (idempotent)', () => {
    manager.open('t1', 80, 24);
    const result = manager.open('t1', 80, 24);
    expect(result).toBe(true);
    // spawn should only be called once
    expect(getSpawnMock()).toHaveBeenCalledOnce();
  });

  it('open rejects when max sessions reached', () => {
    manager.open('t1');
    manager.open('t2');
    const result = manager.open('t3');
    expect(result).toBe(false);
    expect(manager.getActiveCount()).toBe(2);
  });

  it('onData callback forwards output via onOutput', () => {
    manager.open('t1');
    const pty = getLastPty();
    // Simulate pty emitting data
    const dataHandler = pty.onData.mock.calls[0][0];
    dataHandler('hello');
    expect(onOutput).toHaveBeenCalledWith('t1', 'hello');
  });

  it('onExit callback triggers onExit and removes session', () => {
    manager.open('t1');
    const pty = getLastPty();
    const exitHandler = pty.onExit.mock.calls[0][0];
    exitHandler({ exitCode: 0 });
    expect(onExit).toHaveBeenCalledWith('t1', 0);
    expect(manager.getActiveCount()).toBe(0);
  });

  it('write sends data to the pty', () => {
    manager.open('t1');
    const pty = getLastPty();
    manager.write('t1', 'ls\n');
    expect(pty.write).toHaveBeenCalledWith('ls\n');
  });

  it('write does nothing for unknown terminalId', () => {
    manager.write('unknown', 'data');
    // no throw, no pty call
    expect(getSpawnMock()).not.toHaveBeenCalled();
  });

  it('resize calls pty.resize', () => {
    manager.open('t1');
    const pty = getLastPty();
    manager.resize('t1', 120, 40);
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('resize does nothing for unknown terminalId', () => {
    manager.resize('unknown', 120, 40);
    // no throw
  });

  it('close kills pty and removes session', () => {
    manager.open('t1');
    const pty = getLastPty();
    manager.close('t1');
    expect(pty.kill).toHaveBeenCalledOnce();
    expect(manager.getActiveCount()).toBe(0);
  });

  it('close does nothing for unknown terminalId', () => {
    manager.close('unknown');
    // no throw
  });

  it('idle timeout triggers close', () => {
    manager.open('t1');
    const pty = getLastPty();
    expect(manager.getActiveCount()).toBe(1);

    // Advance time past idle timeout
    vi.advanceTimersByTime(5001);

    expect(pty.kill).toHaveBeenCalledOnce();
    expect(manager.getActiveCount()).toBe(0);
  });

  it('write resets idle timer', () => {
    manager.open('t1');
    const pty = getLastPty();

    // Advance 4 seconds (just below timeout)
    vi.advanceTimersByTime(4000);
    // Write resets the timer
    manager.write('t1', 'ping');
    // Advance another 4 seconds — should NOT have closed yet
    vi.advanceTimersByTime(4000);
    expect(pty.kill).not.toHaveBeenCalled();
    expect(manager.getActiveCount()).toBe(1);

    // Advance past the reset timeout
    vi.advanceTimersByTime(1001);
    expect(pty.kill).toHaveBeenCalledOnce();
    expect(manager.getActiveCount()).toBe(0);
  });

  it('closeAll cleans up all sessions', () => {
    manager.open('t1');
    manager.open('t2');
    // Both ptys are the same shared mock object; kill is called once per session
    const pty = getLastPty();

    manager.closeAll();
    // kill should be called for each session (2 total)
    expect(pty.kill).toHaveBeenCalledTimes(2);
    expect(manager.getActiveCount()).toBe(0);
  });

  it('getActiveCount reflects current session count', () => {
    expect(manager.getActiveCount()).toBe(0);
    manager.open('t1');
    expect(manager.getActiveCount()).toBe(1);
    manager.open('t2');
    expect(manager.getActiveCount()).toBe(2);
    manager.close('t1');
    expect(manager.getActiveCount()).toBe(1);
  });
});
