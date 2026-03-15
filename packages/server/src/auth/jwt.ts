import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY_DAYS } from '@ccclaw/shared';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface JwtPayload {
  sub: string; // userId
  role: string;
}

export async function signAccessToken(userId: string, role: string): Promise<string> {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JwtPayload;
}

export async function createRefreshToken(userId: string): Promise<string> {
  // 删除该用户旧的 refresh token（单设备单 token）
  await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, userId));

  const token = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(schema.refreshTokens).values({ userId, token, expiresAt: expiresAt.toISOString() });
  return token;
}

export async function validateRefreshToken(token: string): Promise<string | null> {
  const rows = await db.select().from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.token, token)).limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const expires = new Date(row.expiresAt);
  if (expires <= new Date()) return null;
  return row.userId;
}

export async function revokeRefreshToken(userId: string): Promise<void> {
  await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, userId));
}
