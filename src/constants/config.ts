export interface AuthConfig {
  apiUrl: string;
  portalUrl: string;
  clientId: string;
  redirectUri: string;
}

export function readAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const origin = (key: string) => {
    const value = env[key];
    if (!value || value !== value.trim()) throw new Error(`Configure ${key}.`);
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`Invalid ${key}.`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || /[?#<>]/.test(value)) {
      throw new Error(`Invalid ${key}: use an HTTP(S) origin.`);
    }
    return url.origin;
  };
  const clientId = env.EXPO_PUBLIC_OAUTH_CLIENT_ID?.trim();
  if (!clientId || /^(replace|placeholder|<)/i.test(clientId)) {
    throw new Error('Configure EXPO_PUBLIC_OAUTH_CLIENT_ID.');
  }
  const redirectUri = env.EXPO_PUBLIC_OAUTH_REDIRECT_URI ?? 'rita-id-app://redirect';
  if (redirectUri !== 'rita-id-app://redirect') {
    throw new Error('EXPO_PUBLIC_OAUTH_REDIRECT_URI must be rita-id-app://redirect.');
  }
  const baseUrl = origin('EXPO_PUBLIC_RITA_BASE_URL');
  return {
    apiUrl: baseUrl + '/api',
    portalUrl: baseUrl, clientId, redirectUri,
  };
}

export function getAuthConfig(): AuthConfig {
  // Expo substitutes statically referenced EXPO_PUBLIC properties.
  return readAuthConfig({
    EXPO_PUBLIC_RITA_BASE_URL: process.env.EXPO_PUBLIC_RITA_BASE_URL,
    EXPO_PUBLIC_OAUTH_CLIENT_ID: process.env.EXPO_PUBLIC_OAUTH_CLIENT_ID,
    EXPO_PUBLIC_OAUTH_REDIRECT_URI: process.env.EXPO_PUBLIC_OAUTH_REDIRECT_URI,
  });
}
