/**
 * Returns MOCK_TOKEN only outside production.
 * Prevents accidental auth bypass if MOCK_TOKEN is set in a production env.
 */
export function getDevMockToken(
  isProduction: boolean,
  mockToken: string | undefined = process.env.MOCK_TOKEN,
): string | undefined {
  return isProduction ? undefined : mockToken;
}
