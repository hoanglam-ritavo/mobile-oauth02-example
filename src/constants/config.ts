declare const __DEV__: boolean;

export const RITA_CALLBACK_URI = "rita-partner-demo://redirect";
const defaultAuthorizeUrl = "rita-id://oauth/authorize";

export interface AuthConfig {
  backendOrigin: string;
  authorizeUrl: string;
}

function isExpoGoAuthorizeUrl(value: string): boolean {
  const match = /^exp:\/\/(\[[a-fA-F0-9:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?\/--\/oauth\/authorize$/.exec(value);
  if (!match || match[0] !== value) return false;

  const [, hostname, port] = match;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return false;
  if (!hostname.startsWith("[") && !hostname.replace(/\.$/, "").split(".").every(
    label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  )) return false;

  try {
    // Parse the host as HTTP because Expo Go uses it to reach Metro.
    return new URL(`http://${hostname}`).hostname !== "";
  } catch {
    return false;
  }
}

export function readAuthConfig(env: Record<string, string | undefined>, development = false): AuthConfig {
  const value = env.EXPO_PUBLIC_APP_BACKEND_BASE_URL;
  const invalidOrigin = () => new Error("Configure EXPO_PUBLIC_APP_BACKEND_BASE_URL as an HTTP(S) origin. HTTPS is required in release builds.");
  if (!value || !/^https?:\/\/[^/?#\\]/i.test(value) || /[\s?#<>\\]/.test(value)) throw invalidOrigin();
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw invalidOrigin();
  }
  if (origin.username || origin.password || origin.pathname !== "/" ||
      (!development && origin.protocol !== "https:")) throw invalidOrigin();

  const authorizeUrl = env.EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL ?? defaultAuthorizeUrl;
  const isNativeAuthorizeUrl = /^rita-id:\/\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)+$/.test(authorizeUrl);
  if (!isNativeAuthorizeUrl && !(development && isExpoGoAuthorizeUrl(authorizeUrl))) {
    const expected = development
      ? "a Rita Võ ID app link or an Expo Go link (exp://<metro-host>[:<port>]/--/oauth/authorize)"
      : "a Rita Võ ID app link (rita-id://oauth/authorize)";
    throw new Error(`Configure EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL as ${expected}.`);
  }
  return { backendOrigin: origin.origin, authorizeUrl };
}

export function getAuthConfig(): AuthConfig {
  return readAuthConfig({
    EXPO_PUBLIC_APP_BACKEND_BASE_URL: process.env.EXPO_PUBLIC_APP_BACKEND_BASE_URL,
    EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL: process.env.EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL,
  }, __DEV__);
}
