import { describe, it, expect } from 'vitest';
import { serializeDirectMessage, parseDirectMessage, DirectMessage } from './direct-message.js';

describe('serializeDirectMessage / parseDirectMessage', () => {
  it('should roundtrip serialize and parse', () => {
    const msg: DirectMessage = {
      channel: 'chat',
      action: 'send',
      requestId: 'req-1',
      data: { text: 'hello' },
    };
    const raw = serializeDirectMessage(msg);
    const parsed = parseDirectMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it('should parse message without requestId', () => {
    const msg: DirectMessage = {
      channel: 'tree',
      action: 'list',
      data: { path: '/' },
    };
    const raw = serializeDirectMessage(msg);
    const parsed = parseDirectMessage(raw);
    expect(parsed).toEqual(msg);
    expect(parsed.requestId).toBeUndefined();
  });

  it('should throw on missing channel', () => {
    const raw = JSON.stringify({ action: 'send', data: {} });
    expect(() => parseDirectMessage(raw)).toThrow('Invalid DirectMessage');
  });

  it('should throw on missing data field', () => {
    const raw = JSON.stringify({ channel: 'chat', action: 'send' });
    expect(() => parseDirectMessage(raw)).toThrow('Invalid DirectMessage');
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseDirectMessage('not json')).toThrow();
  });
});
