import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('should hash and verify password', async () => {
    const hash = await hashPassword('test-password');
    expect(hash).not.toBe('test-password');
    expect(await verifyPassword('test-password', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
