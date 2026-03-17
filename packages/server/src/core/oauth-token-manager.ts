import { encrypt, decrypt } from '@ccclaw/shared';

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  status: 'available' | 'pending';
}

export const OAUTH_ENDPOINTS: Record<string, OAuthConfig> = {
  claude: {
    authorizeUrl: 'https://console.anthropic.com/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/oauth/token',
    scopes: ['messages:write'],
    status: 'pending',  // Not yet publicly available
  },
  gemini: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/generative-language'],
    status: 'available',
  },
  qwen: {
    authorizeUrl: 'https://auth.aliyun.com/authorize',
    tokenUrl: 'https://auth.aliyun.com/token',
    scopes: ['qwen:chat'],
    status: 'pending',
  },
};

export class OAuthTokenManager {
  /**
   * Get a valid token. If expired, refresh automatically.
   */
  async getToken(oauthState: string, encryptionKey: string, providerType: string): Promise<string> {
    const state = JSON.parse(decrypt(oauthState, encryptionKey));
    const expiresAt = new Date(state.expiresAt).getTime();
    const fiveMinutes = 5 * 60 * 1000;

    if (Date.now() < expiresAt - fiveMinutes) {
      return state.accessToken;
    }

    // Refresh
    const config = OAUTH_ENDPOINTS[providerType];
    if (!config) throw new Error(`Unknown OAuth provider: ${providerType}`);

    const clientId = process.env[`OAUTH_${providerType.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`OAUTH_${providerType.toUpperCase()}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) throw new Error(`OAuth credentials not configured for ${providerType}`);

    const resp = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: state.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!resp.ok) throw new Error(`OAuth refresh failed: ${resp.status}`);
    const tokens = await resp.json();

    return tokens.access_token;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(type: string, code: string, codeVerifier: string, redirectUri: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    scope: string;
  }> {
    const config = OAUTH_ENDPOINTS[type];
    if (!config) throw new Error(`Unknown OAuth provider: ${type}`);

    const clientId = process.env[`OAUTH_${type.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`OAUTH_${type.toUpperCase()}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) throw new Error(`OAuth credentials not configured for ${type}`);

    const resp = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OAuth code exchange failed: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in || 3600,
      scope: data.scope || '',
    };
  }
}
