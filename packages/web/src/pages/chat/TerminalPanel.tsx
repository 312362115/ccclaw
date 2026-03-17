import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { CloseIcon } from '../../components/icons';
import { useResizable } from '../../hooks/useResizable';
import {
  sendTerminalOpen,
  sendTerminalInput,
  sendTerminalResize,
  sendTerminalClose,
  onTerminalOutput,
  onTerminalExit,
  offTerminal,
} from '../../api/ws';

interface Props {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

export function TerminalPanel({ workspaceId, open, onClose }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionId = workspaceId + '_terminal';

  const { size, dragging, onMouseDown } = useResizable({
    storageKey: 'cc-terminal-height',
    defaultSize: 240,
    minSize: 120,
    maxSize: 600,
    direction: 'vertical',
  });

  // refit xterm when size changes
  useEffect(() => {
    if (open && fitRef.current) {
      fitRef.current.fit();
    }
  }, [size, open]);

  useEffect(() => {
    if (!open || !termRef.current || !workspaceId) return;

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#22d3ee',
      },
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(termRef.current);

    requestAnimationFrame(() => fit.fit());

    xtermRef.current = xterm;
    fitRef.current = fit;

    sendTerminalOpen(workspaceId, sessionId, xterm.cols, xterm.rows);

    xterm.onData((data) => {
      sendTerminalInput(workspaceId, sessionId, data);
    });

    onTerminalOutput(sessionId, (data) => {
      xterm.write(data);
    });

    onTerminalExit(sessionId, (code) => {
      xterm.write(`\r\n[Process exited with code ${code}]\r\n`);
    });

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      sendTerminalResize(workspaceId, sessionId, xterm.cols, xterm.rows);
    });
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      sendTerminalClose(workspaceId, sessionId);
      offTerminal(sessionId);
      xterm.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [open, workspaceId]);

  return (
    <div
      className={`overflow-hidden border-t shrink-0 ${
        open ? 'border-t-slate-800' : 'h-0 border-t-transparent'
      }`}
      style={open ? { height: `${size}px`, background: '#0f172a' } : { height: 0, background: '#0f172a' }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="h-1.5 flex items-center justify-center cursor-ns-resize bg-slate-800 select-none"
      >
        <div className={`rounded-full transition-all duration-200 ${dragging ? 'w-12 h-[3px] bg-accent' : 'w-8 h-[3px] bg-slate-600 hover:bg-accent hover:w-12'}`} />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-800 border-b border-slate-700">
        <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-success" />
          Terminal
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-700 hover:text-slate-200 transition-all duration-200"
        >
          <CloseIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal body */}
      <div ref={termRef} className="h-[calc(100%-50px)] px-1" />
    </div>
  );
}
