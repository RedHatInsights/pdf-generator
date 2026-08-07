import config from '../common/config';
import { apiLogger } from '../common/logging';

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export type RefreshResult =
  { accessToken: string } | { error: 'permanent' | 'transient' } | null;

export function isTokenExpiringSoon(token: string): boolean {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString(),
    );
    const expiresAt = payload.exp * 1000;
    return Date.now() + TOKEN_EXPIRY_BUFFER_MS > expiresAt;
  } catch {
    return false;
  }
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshResult> {
  if (!config.SSO_URL) {
    apiLogger.debug('[token-refresh] SSO_URL not configured, skipping refresh');
    return null;
  }

  const tokenUrl = `${config.SSO_URL}realms/redhat-external/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.SSO_CLIENT_ID,
    refresh_token: refreshToken.replace(/^Bearer\s+/i, ''),
  });

  try {
    apiLogger.debug(`[token-refresh] Refreshing access token via ${tokenUrl}`);
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      apiLogger.error(`[token-refresh] Failed: ${response.status} ${text}`);
      // Keycloak returns 400 for invalid_grant (token expired/revoked) — won't recover
      if (response.status === 400) {
        return { error: 'permanent' };
      }
      return { error: 'transient' };
    }

    const data = (await response.json()) as { access_token: string };
    apiLogger.debug('[token-refresh] Token refreshed successfully');
    return { accessToken: `Bearer ${data.access_token}` };
  } catch (error) {
    apiLogger.error(`[token-refresh] Error: ${error}`);
    return { error: 'transient' };
  }
}

export class TokenManager {
  private token: string | undefined;
  private readonly _refreshToken: string | undefined;
  private refreshPromise: Promise<string | null> | null = null;
  private permanentlyFailed = false;

  constructor(authHeader?: string, refreshToken?: string) {
    this.token = authHeader;
    this._refreshToken = refreshToken;
  }

  async getValidToken(): Promise<string | undefined> {
    if (!this.token || !this._refreshToken) {
      return this.token;
    }
    if (!isTokenExpiringSoon(this.token.replace(/^Bearer\s+/i, ''))) {
      return this.token;
    }
    return this.coalesce();
  }

  get currentToken(): string | undefined {
    return this.token;
  }

  private async coalesce(): Promise<string | undefined> {
    if (this.permanentlyFailed) {
      return undefined;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = refreshAccessToken(this._refreshToken!)
        .then((result) => {
          if (result && 'accessToken' in result) {
            this.token = result.accessToken;
          } else if (result && result.error === 'permanent') {
            this.permanentlyFailed = true;
            apiLogger.debug(
              '[token-refresh] Permanent failure, skipping future refreshes',
            );
            return null;
          } else if (result && result.error === 'transient') {
            apiLogger.warning(
              '[token-refresh] Transient failure, proceeding with expiring token',
            );
          }
          return this.token ?? null;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }
    return (await this.refreshPromise) ?? undefined;
  }
}
