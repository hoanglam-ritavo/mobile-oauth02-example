declare const __DEV__: boolean;

export const RITA_CALLBACK_URI = "rita-partner-demo://redirect";
const defaultAuthorizeUrl = "rita-id://oauth/authorize";

export interface AuthConfig {
  backendOrigin: string;
  authorizeUrl: string;
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
  if (!/^rita-id:\/\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)+$/.test(authorizeUrl)) {
    throw new Error("Configure EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL as a Rita Võ ID app link.");
  }
  return { backendOrigin: origin.origin, authorizeUrl };
}

export function getAuthConfig(): AuthConfig {
  return readAuthConfig({
    EXPO_PUBLIC_APP_BACKEND_BASE_URL: process.env.EXPO_PUBLIC_APP_BACKEND_BASE_URL,
    EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL: process.env.EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL,
  }, __DEV__);
}
