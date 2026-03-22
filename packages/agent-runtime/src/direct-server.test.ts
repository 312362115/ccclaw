import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { DirectMessage } from '@ccclaw/shared';
import { DirectServer } from './direct-server.js';

const VALID_TOKEN = 'test-token-valid';

function createTestServer(onMessage?: (clientId: string, msg: DirectMessage) => void) {
  return new DirectServer({
    verifyToken: async (token) => token === VALID_TOKEN,
    onMessage: onMessage ?? (() => {}),
  });
}

function connectWs(server: DirectServer, token?: string): WebSocket {
  const url = token !== undefined
    ? `${server.directUrl}?token=${token}`
    : server.directUrl;
  return new WebSocket(url);
}

describe('DirectServer', () => {
  let server: DirectServer | undefined;

  afterEach(() => {
    server?.stop();
    server = undefined;
  });

  it('exposes port and directUrl after start', async () => {
    server = createTestServer();
    await server.start();
    expect(server.port).toBeGreaterThan(0);
    expect(server.directUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });

  it('rejects connection without token', async () => {
    server = createTestServer();
    await server.start();

    const ws = connectWs(server);
    const code = await new Promise<number>((resolve) => {
      ws.on('error', () => {});
      ws.on('close', (code) => resolve(code));
    });
    // Connection destroyed before upgrade — expect 1006
    expect(code).toBe(1006);
  });

  it('rejects connection with invalid token', async () => {
    server = createTestServer();
    await server.start();

    const ws = connectWs(server, 'bad-token');
    const code = await new Promise<number>((resolve) => {
      ws.on('error', () => {});
      ws.on('close', (code) => resolve(code));
    });
    expect(code).toBe(1006);
  });

  it('accepts connection with valid token and exchanges JSON messages', async () => {
    const received: DirectMessage[] = [];

    server = createTestServer((clientId, msg) => {
      received.push(msg);
      // Echo back
      server!.sendToClient(clientId, {
        channel: 'system',
        action: 'echo',
        data: msg.data,
      });
    });
    await server.start();

    const ws = connectWs(server, VALID_TOKEN);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    // Send a plain JSON message
    const outMsg: DirectMessage = {
      channel: 'chat',
      action: 'send',
      data: { text: 'hello plain world' },
    };
    ws.send(JSON.stringify(outMsg));

    // Wait for the echo response (plain JSON text frame)
    const response = await new Promise<DirectMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for echo')), 3000);
      ws.on('message', (data: Buffer | string) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });

    expect(response.channel).toBe('system');
    expect(response.action).toBe('echo');
    expect(response.data).toEqual({ text: 'hello plain world' });

    // Verify server received the original message
    expect(received).toHaveLength(1);
    expect(received[0].channel).toBe('chat');
    expect(received[0].action).toBe('send');

    ws.close();
  });

  it('sendToClient sends JSON text to the correct client', async () => {
    const clientIds: string[] = [];

    server = createTestServer((clientId) => {
      clientIds.push(clientId);
    });
    await server.start();

    // Connect two clients
    const ws1 = connectWs(server, VALID_TOKEN);
    const ws2 = connectWs(server, VALID_TOKEN);
    await Promise.all([
      new Promise<void>((r) => ws1.on('open', r)),
      new Promise<void>((r) => ws2.on('open', r)),
    ]);

    // Both clients send a message so we can capture their clientIds
    ws1.send(JSON.stringify({ channel: 'ping', action: 'id', data: null }));
    ws2.send(JSON.stringify({ channel: 'ping', action: 'id', data: null }));

    // Wait for both clientIds
    await vi.waitFor(() => expect(clientIds).toHaveLength(2), { timeout: 2000 });

    // Send a message only to client 1
    const msg: DirectMessage = { channel: 'test', action: 'targeted', data: 'for-client-1' };

    const p1 = new Promise<DirectMessage>((resolve) => {
      ws1.on('message', (d: Buffer | string) => resolve(JSON.parse(d.toString())));
    });
    const p2NoMsg = new Promise<string>((resolve) => {
      ws2.on('message', () => resolve('got-message'));
      setTimeout(() => resolve('no-message'), 500);
    });

    server.sendToClient(clientIds[0], msg);

    const result1 = await p1;
    expect(result1.action).toBe('targeted');
    expect(result1.data).toBe('for-client-1');

    const result2 = await p2NoMsg;
    expect(result2).toBe('no-message');

    ws1.close();
    ws2.close();
  });

  it('handles tunnel clients: handleTunnelFrame parses JSON and routes sendToClient', async () => {
    const received: DirectMessage[] = [];
    const tunnelSent: Array<{ clientId: string; data: string }> = [];

    server = createTestServer((clientId, msg) => {
      received.push(msg);
    });
    await server.start();

    server.setTunnelSend((clientId, data) => {
      tunnelSent.push({ clientId, data });
    });

    const tunnelClientId = 'tunnel-client-1';

    // Simulate an incoming tunnel message (plain JSON string)
    const inMsg: DirectMessage = {
      channel: 'file',
      action: 'upload',
      data: { name: 'test.txt' },
    };
    server.handleTunnelFrame(tunnelClientId, JSON.stringify(inMsg));

    expect(received).toHaveLength(1);
    expect(received[0].channel).toBe('file');
    expect(received[0].action).toBe('upload');

    // Send a message to the tunnel client — should go through tunnelSend
    const outMsg: DirectMessage = {
      channel: 'file',
      action: 'upload-ok',
      data: null,
    };
    server.sendToClient(tunnelClientId, outMsg);

    expect(tunnelSent).toHaveLength(1);
    expect(tunnelSent[0].clientId).toBe(tunnelClientId);
    const sentMsg = JSON.parse(tunnelSent[0].data) as DirectMessage;
    expect(sentMsg.action).toBe('upload-ok');
  });

  it('removeTunnelClient removes tunnel client session', async () => {
    const tunnelSent: Array<{ clientId: string; data: string }> = [];

    server = createTestServer();
    await server.start();

    server.setTunnelSend((clientId, data) => {
      tunnelSent.push({ clientId, data });
    });

    const tunnelClientId = 'tunnel-remove-test';

    // Register tunnel client
    server.handleTunnelFrame(tunnelClientId, JSON.stringify({
      channel: 'test', action: 'init', data: null,
    }));

    // Remove it
    server.removeTunnelClient(tunnelClientId);

    // sendToClient should do nothing now
    server.sendToClient(tunnelClientId, {
      channel: 'test', action: 'should-not-arrive', data: null,
    });

    expect(tunnelSent).toHaveLength(0);
  });

  it('handleTunnelFrame with empty data removes tunnel client', async () => {
    server = createTestServer();
    await server.start();

    server.setTunnelSend(() => {});

    const tunnelClientId = 'tunnel-empty-test';

    // Register
    server.handleTunnelFrame(tunnelClientId, JSON.stringify({
      channel: 'test', action: 'init', data: null,
    }));

    // Empty data signals disconnect
    server.handleTunnelFrame(tunnelClientId, '');

    // Client should be gone — sendToClient should be a no-op
    const tunnelSent: string[] = [];
    server.setTunnelSend((_, data) => tunnelSent.push(data));
    server.sendToClient(tunnelClientId, {
      channel: 'test', action: 'should-not-arrive', data: null,
    });
    expect(tunnelSent).toHaveLength(0);
  });
});
