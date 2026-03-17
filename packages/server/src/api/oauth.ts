import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt } from '@ccclaw/shared';
import { config } from '../config.js';
import { OAUTH_ENDPOINTS, OAuthTokenManager } from '../core/oauth-token-manager.js';
import type { AppEnv } from '../types.js';

export const oauthRouter = new Hono<AppEnv>();

oauthRouter.use('*', authMiddleware);

const tokenManager = new OAuthTokenManager();

// GET /api/oauth/:type/authorize — Generate state + PKCE, redirect to provider
oauthRouter.get('/:type/authorize', async (c) => {
  const type = c.req.param('type');
  const userId = c.get('user').sub;

  const oauthConfig = OAUTH_ENDPOINTS[type];
  if (!oauthConfig) {
    return c.json({ error: `Unknown OAuth provider: ${type}` }, 400);
  }

  // Generate random state (32 bytes hex)
  const state = randomBytes(32).toString('hex');

  // Generate PKCE code_verifier (43 bytes base64url)
  const codeVerifier = randomBytes(43).toString('base64url');

  // Store state in oauth_states table (expires in 10 minutes)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.insert(schema.oauthStates).values({
    state,
    userId,
    type,
    codeVerifier,
    expiresAt,
  } as any);

  // Build PKCE code_challenge (S256)
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const codeChallenge = btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const clientId = process.env[`OAUTH_${type.toUpperCase()}_CLIENT_ID`];
  if (!clientId) {
    return c.json({ error: `OAuth client ID not configured for ${type}` }, 500);
  }

  const redirectUri = `${c.req.header('origin') ?? ''}/api/oauth/${type}/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: oauthConfig.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return c.redirect(`${oauthConfig.authorizeUrl}?${params.toString()}`);
});

// GET /api/oauth/:type/callback — Exchange code, store tokens
oauthRouter.get('/:type/callback', async (c) => {
  const type = c.req.param('type');
  const userId = c.get('user').sub;

  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.redirect(`/settings/providers?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return c.redirect('/settings/providers?error=missing_params');
  }

  // Validate state from oauth_states
  const [oauthState] = await db.select().from(schema.oauthStates)
    .where(and(
      eq(schema.oauthStates.state, state),
      eq(schema.oauthStates.userId, userId),
      eq(schema.oauthStates.type, type),
    ))
    .limit(1);

  if (!oauthState) {
    return c.redirect('/settings/providers?error=invalid_state');
  }

  // Check if state is expired
  if (new Date(oauthState.expiresAt) < new Date()) {
    await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
    return c.redirect('/settings/providers?error=state_expired');
  }

  const redirectUri = `${c.req.header('origin') ?? ''}/api/oauth/${type}/callback`;

  try {
    // Exchange authorization code for tokens
    const tokens = await tokenManager.exchangeCode(type, code, oauthState.codeVerifier, redirectUri);

    // Encrypt tokens for storage
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
    const encryptedState = encrypt(JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt,
      scope: tokens.scope,
    }), config.ENCRYPTION_KEY);

    // Find existing provider for this user and type, update oauthState
    const [existingProvider] = await db.select().from(schema.providers)
      .where(and(
        eq(schema.providers.userId, userId),
        eq(schema.providers.type, type),
        eq(schema.providers.authType, 'oauth'),
      ))
      .limit(1);

    if (existingProvider) {
      await db.update(schema.providers)
        .set({ oauthState: encryptedState } as any)
        .where(eq(schema.providers.id, existingProvider.id));
    } else {
      // Create a new provider entry for this OAuth connection
      await db.insert(schema.providers).values({
        userId,
        name: `${type} (OAuth)`,
        type,
        authType: 'oauth',
        config: encrypt(JSON.stringify({}), config.ENCRYPTION_KEY),
        isDefault: false,
        oauthState: encryptedState,
      } as any);
    }

    // Delete the used oauth_state
    await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));

    return c.redirect('/settings/providers?oauth=success');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
    return c.redirect(`/settings/providers?error=${encodeURIComponent(message)}`);
  }
});
