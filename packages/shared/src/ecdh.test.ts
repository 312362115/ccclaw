import { describe, it, expect } from 'vitest';
import {
  generateECDHKeyPair,
  deriveSharedKey,
  publicKeyFromBase64,
  encryptFrame,
  decryptFrame,
  RENEGOTIATE_THRESHOLD,
} from './ecdh.js';

describe('ecdh', () => {
  describe('generateECDHKeyPair', () => {
    it('should return publicKey, privateKey, and publicKeyBase64', () => {
      const kp = generateECDHKeyPair();
      expect(kp.publicKey).toBeInstanceOf(Buffer);
      expect(kp.privateKey).toBeInstanceOf(Buffer);
      expect(typeof kp.publicKeyBase64).toBe('string');
    });

    it('publicKeyBase64 should round-trip via publicKeyFromBase64', () => {
      const kp = generateECDHKeyPair();
      const restored = publicKeyFromBase64(kp.publicKeyBase64);
      expect(restored.equals(kp.publicKey)).toBe(true);
    });
  });

  describe('deriveSharedKey', () => {
    it('both sides derive identical shared keys', () => {
      const alice = generateECDHKeyPair();
      const bob = generateECDHKeyPair();

      const sharedA = deriveSharedKey(alice.privateKey, bob.publicKey);
      const sharedB = deriveSharedKey(bob.privateKey, alice.publicKey);

      expect(sharedA).toBeInstanceOf(Buffer);
      expect(sharedA.length).toBe(32);
      expect(sharedA.equals(sharedB)).toBe(true);
    });
  });

  describe('encryptFrame / decryptFrame', () => {
    it('encrypt then decrypt roundtrip', () => {
      const alice = generateECDHKeyPair();
      const bob = generateECDHKeyPair();
      const sharedKey = deriveSharedKey(alice.privateKey, bob.publicKey);

      const plaintext = 'hello, encrypted world!';
      const counter = 42;
      const frame = encryptFrame(plaintext, sharedKey, counter);

      expect(frame).toBeInstanceOf(Buffer);
      // frame = 12 bytes nonce + ciphertext + 16 bytes tag
      expect(frame.length).toBeGreaterThan(12 + 16);

      const decrypted = decryptFrame(frame, sharedKey, counter);
      expect(decrypted).toBe(plaintext);
    });

    it('wrong counter rejects frame', () => {
      const alice = generateECDHKeyPair();
      const bob = generateECDHKeyPair();
      const sharedKey = deriveSharedKey(alice.privateKey, bob.publicKey);

      const frame = encryptFrame('secret', sharedKey, 1);
      expect(() => decryptFrame(frame, sharedKey, 2)).toThrow();
    });

    it('different counters produce different ciphertexts', () => {
      const alice = generateECDHKeyPair();
      const bob = generateECDHKeyPair();
      const sharedKey = deriveSharedKey(alice.privateKey, bob.publicKey);

      const plaintext = 'same input';
      const frameA = encryptFrame(plaintext, sharedKey, 1);
      const frameB = encryptFrame(plaintext, sharedKey, 2);

      expect(frameA.equals(frameB)).toBe(false);
    });
  });

  describe('RENEGOTIATE_THRESHOLD', () => {
    it('should equal 2^48', () => {
      expect(RENEGOTIATE_THRESHOLD).toBe(2 ** 48);
    });
  });
});
