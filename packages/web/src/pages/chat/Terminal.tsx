import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  sendTerminalOpen,
  sendTerminalInput,
  sendTerminalResize,
  sendTerminalClose,
  onTerminalOutput,
  onTerminalExit,
  offTerminal,
} from '../../api/ws';

export default function Terminal() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionId = workspaceId + '_terminal'; // stable terminal session id

  useEffect(() => {
    if (!termRef.current || !workspaceId) return;

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(termRef.current);
    fit.fit();

    xtermRef.current = xterm;
    fitRef.current = fit;

    // Send terminal open
    sendTerminalOpen(workspaceId, sessionId, xterm.cols, xterm.rows);

    // Handle user input → send to server
    xterm.onData((data) => {
      sendTerminalInput(workspaceId, sessionId, data);
    });

    // Handle server output → write to terminal
    onTerminalOutput(sessionId, (data) => {
      xterm.write(data);
    });

    onTerminalExit(sessionId, (code) => {
      xterm.write(`\r\n[Process exited with code ${code}]\r\n`);
    });

    // Handle resize
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
    };
  }, [workspaceId]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '8px 16px',
          background: '#2d2d2d',
          color: '#ccc',
          fontSize: 13,
          borderBottom: '1px solid #404040',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>Terminal</span>
        <span style={{ fontSize: 11, color: '#888' }}>({workspaceId})</span>
      </div>
      <div ref={termRef} style={{ flex: 1, background: '#1e1e1e' }} />
    </div>
  );
}
