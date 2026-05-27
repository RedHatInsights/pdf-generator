import config from '../common/config';
import { apiLogger } from '../common/logging';

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

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
): Promise<{ accessToken: string } | null> {
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
      return null;
    }

    const data = (await response.json()) as { access_token: string };
    apiLogger.debug('[token-refresh] Token refreshed successfully');
    return { accessToken: `Bearer ${data.access_token}` };
  } catch (error) {
    apiLogger.error(`[token-refresh] Error: ${error}`);
    return null;
  }
}
