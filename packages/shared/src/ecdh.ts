import { createCipheriv, createDecipheriv, createECDH, createHash } from 'node:crypto';

const CURVE = 'prime256v1';
const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

/** Re-key before counter reaches 2^48 to stay within safe nonce space. */
export const RENEGOTIATE_THRESHOLD = 2 ** 48;

export interface ECDHKeyPair {
  publicKey: Buffer;
  privateKey: Buffer;
  publicKeyBase64: string;
}

/**
 * Generate an ECDH P-256 key pair.
 */
export function generateECDHKeyPair(): ECDHKeyPair {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  const publicKey = ecdh.getPublicKey() as Buffer;
  const privateKey = ecdh.getPrivateKey() as Buffer;
  return {
    publicKey,
    privateKey,
    publicKeyBase64: publicKey.toString('base64'),
  };
}

/**
 * Derive a 32-byte shared key from our private key and the other party's public key.
 * Uses SHA-256 over the raw ECDH shared secret to produce a full 256-bit AES key.
 */
export function deriveSharedKey(privateKey: Buffer, otherPublicKey: Buffer): Buffer {
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(privateKey);
  const raw = ecdh.computeSecret(otherPublicKey);
  return createHash('sha256').update(raw).digest() as Buffer;
}

/**
 * Restore a public key Buffer from its base64 representation.
 */
export function publicKeyFromBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/**
 * Convert a monotonic counter to a 12-byte nonce.
 *
 * Layout: [4 bytes zero][4 bytes high BE][4 bytes low BE]
 * This matches the Web Crypto API nonce convention for interoperability.
 */
function counterToNonce(counter: number): Buffer {
  const buf = Buffer.alloc(NONCE_LENGTH);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 4);
  buf.writeUInt32BE(counter >>> 0, 8);
  return buf;
}

/**
 * Encrypt a plaintext string into a binary frame.
 *
 * Frame layout: [12 bytes nonce][ciphertext][16 bytes GCM tag]
 */
export function encryptFrame(plaintext: string, sharedKey: Buffer, counter: number): Buffer {
  const nonce = counterToNonce(counter);
  const cipher = createCipheriv(ALGORITHM, sharedKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, encrypted, tag]);
}

/**
 * Decrypt a binary frame back to a plaintext string.
 *
 * Verifies the counter matches the nonce embedded in the frame.
 */
export function decryptFrame(frame: Buffer, sharedKey: Buffer, expectedCounter: number): string {
  const nonce = frame.subarray(0, NONCE_LENGTH);
  const expectedNonce = counterToNonce(expectedCounter);

  if (!nonce.equals(expectedNonce)) {
    throw new Error('Frame counter mismatch');
  }

  const ciphertext = frame.subarray(NONCE_LENGTH, frame.length - TAG_LENGTH);
  const tag = frame.subarray(frame.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, sharedKey, nonce);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
