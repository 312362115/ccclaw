import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto.js';

describe('crypto', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('should encrypt and decrypt a string', () => {
    const plaintext = 'sk-ant-api03-secret-key';
    const encrypted = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });

  it('should produce different ciphertexts for same input', () => {
    const plaintext = 'same-input';
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);
    expect(a).not.toBe(b);
  });

  it('should throw on wrong key', () => {
    const encrypted = encrypt('secret', key);
    const wrongKey = 'ff'.repeat(32);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});
