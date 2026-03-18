import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
  generateECDHKeyPair,
  deriveSharedKey,
  publicKeyFromBase64,
  encryptFrame,
  decryptFrame,
  serializeDirectMessage,
  parseDirectMessage,
  type DirectMessage,
} from '@ccclaw/shared';
import { DirectServer } from './direct-server.js';

const VALID_TOKEN = 'test-token-valid';

function createServer(onMessage?: (clientId: string, msg: DirectMessage) => void) {
  return new DirectServer({
    keyPair: generateECDHKeyPair(),
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

/** Complete the ECDH handshake and return the derived shared key + client keypair */
async function doHandshake(ws: WebSocket, clientKp: ReturnType<typeof generateECDHKeyPair>) {
  return new Promise<{ sharedKey: Buffer; runnerPublicKey: Buffer }>((resolve, reject) => {
    ws.once('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());
        expect(msg.type).toBe('handshake_ok');
        expect(msg.runnerPublicKey).toBeDefined();
        const runnerPub = publicKeyFromBase64(msg.runnerPublicKey);
        const sharedKey = deriveSharedKey(clientKp.privateKey, runnerPub);
        resolve({ sharedKey, runnerPublicKey: runnerPub });
      } catch (err) {
        reject(err);
      }
    });
    ws.send(JSON.stringify({ type: 'handshake', clientPublicKey: clientKp.publicKeyBase64 }));
  });
}

describe('DirectServer', () => {
  let server: DirectServer | undefined;

  afterEach(() => {
    server?.stop();
    server = undefined;
  });

  it('exposes port and directUrl after start', async () => {
    server = createServer();
    await server.start();
    expect(server.port).toBeGreaterThan(0);
    expect(server.directUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });

  it('rejects connection without valid token', async () => {
    server = createServer();
    await server.start();

    const ws = connectWs(server, 'bad-token');
    const code = await new Promise<number>((resolve) => {
      ws.on('error', () => {
        // swallow – close event will follow
      });
      ws.on('close', (code) => resolve(code));
    });
    // Connection closed before WebSocket upgrade completes — code may be 1006
    expect([1006, 4001]).toContain(code);
  });

  it('rejects connection with no token', async () => {
    server = createServer();
    await server.start();

    const ws = connectWs(server);
    const code = await new Promise<number>((resolve) => {
      ws.on('error', () => {});
      ws.on('close', (code) => resolve(code));
    });
    expect([1006, 4001]).toContain(code);
  });

  it('completes ECDH handshake with valid token', async () => {
    server = createServer();
    await server.start();

    const ws = connectWs(server, VALID_TOKEN);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    const clientKp = generateECDHKeyPair();
    const { sharedKey } = await doHandshake(ws, clientKp);
    expect(sharedKey).toBeInstanceOf(Buffer);
    expect(sharedKey.length).toBe(32);

    ws.close();
  });

  it('exchanges encrypted messages after handshake', async () => {
    const received: DirectMessage[] = [];

    server = createServer((clientId, msg) => {
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

    const clientKp = generateECDHKeyPair();
    const { sharedKey } = await doHandshake(ws, clientKp);

    // Client sends an encrypted message (counter starts at 0 for client->server)
    const outMsg: DirectMessage = {
      channel: 'chat',
      action: 'send',
      data: { text: 'hello encrypted world' },
    };
    const frame = encryptFrame(serializeDirectMessage(outMsg), sharedKey, 0);
    ws.send(frame);

    // Wait for the echo response (encrypted binary frame)
    const responseFrame = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for echo')), 3000);
      ws.on('message', (data: Buffer) => {
        clearTimeout(timer);
        resolve(Buffer.from(data as ArrayLike<number>));
      });
    });

    // Decrypt: server->client counter starts at 0
    const decrypted = decryptFrame(responseFrame, sharedKey, 0);
    const echoMsg = parseDirectMessage(decrypted);
    expect(echoMsg.channel).toBe('system');
    expect(echoMsg.action).toBe('echo');
    expect(echoMsg.data).toEqual({ text: 'hello encrypted world' });

    // Verify server received the original message
    expect(received).toHaveLength(1);
    expect(received[0].channel).toBe('chat');
    expect(received[0].action).toBe('send');

    ws.close();
  });
});
