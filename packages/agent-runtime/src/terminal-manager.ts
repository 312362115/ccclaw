import { spawn, type IPty } from 'node-pty';

export interface TerminalSession {
  id: string;
  pty: IPty;
  idleTimer: NodeJS.Timeout | null;
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private maxSessions: number;
  private idleTimeoutMs: number;
  private workspaceDir: string;
  private onOutput: (terminalId: string, data: string) => void;
  private onExit: (terminalId: string, code: number) => void;

  constructor(options: {
    workspaceDir: string;
    maxSessions?: number;       // default 2
    idleTimeoutMs?: number;     // default 10 * 60 * 1000 (10 min)
    onOutput: (terminalId: string, data: string) => void;
    onExit: (terminalId: string, code: number) => void;
  }) {
    this.workspaceDir = options.workspaceDir;
    this.maxSessions = options.maxSessions ?? 2;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60 * 1000;
    this.onOutput = options.onOutput;
    this.onExit = options.onExit;
  }

  open(terminalId: string, cols = 80, rows = 24): boolean {
    if (this.sessions.size >= this.maxSessions) return false;
    if (this.sessions.has(terminalId)) return true; // already open

    const pty = spawn(process.env.SHELL || '/bin/bash', [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: this.workspaceDir,
      env: process.env as Record<string, string>,
    });

    pty.onData((data: string) => {
      this.resetIdle(terminalId);
      this.onOutput(terminalId, data);
    });

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      this.cleanup(terminalId);
      this.onExit(terminalId, exitCode);
    });

    const session: TerminalSession = { id: terminalId, pty, idleTimer: null };
    this.sessions.set(terminalId, session);
    this.resetIdle(terminalId);
    return true;
  }

  write(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId);
    if (session) {
      this.resetIdle(terminalId);
      session.pty.write(data);
    }
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  close(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.pty.kill();
      this.cleanup(terminalId);
    }
  }

  closeAll(): void {
    for (const [id] of this.sessions) {
      this.close(id);
    }
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  private resetIdle(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      this.close(terminalId);
    }, this.idleTimeoutMs);
  }

  private cleanup(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (session?.idleTimer) clearTimeout(session.idleTimer);
    this.sessions.delete(terminalId);
  }
}
