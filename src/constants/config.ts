declare const __DEV__: boolean;

export const RITA_CALLBACK_URI = "rita-partner-demo://redirect";
const defaultAuthorizeUrl = "rita-id://oauth/authorize";

export interface AuthConfig {
  backendOrigin: string;
  authorizeUrl: string;
  callbackUri: string;
}

export function isExpoGoLink(
  value: string,
  route: "oauth/authorize" | "redirect",
): boolean {
  const match =
    /^exp:\/\/(\[[a-fA-F0-9:.]+\]|[a-zA-Z0-9.-]+):([0-9]+)\/--\/(oauth\/authorize|redirect)$/.exec(
      value,
    );
  if (!match || match[0] !== value || match[3] !== route) return false;

  const [, hostname, port] = match;
  if (Number(port) < 1 || Number(port) > 65535) return false;
  if (
    !hostname.startsWith("[") &&
    !hostname
      .replace(/\.$/, "")
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  )
    return false;

  try {
    // Parse the host as HTTP because Expo Go uses it to reach Metro.
    return new URL(`http://${hostname}`).hostname !== "";
  } catch {
    return false;
  }
}

export function readAuthConfig(
  env: Record<string, string | undefined>,
  development = false,
  androidExpoGo = false,
): AuthConfig {
  const value = env.EXPO_PUBLIC_APP_BACKEND_BASE_URL;
  const invalidOrigin = () =>
    new Error(
      "Configure EXPO_PUBLIC_APP_BACKEND_BASE_URL as an HTTP(S) origin. HTTPS is required in release builds.",
    );
  if (
    !value ||
    !/^https?:\/\/[^/?#\\]/i.test(value) ||
    /[\s?#<>\\]/.test(value)
  )
    throw invalidOrigin();
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw invalidOrigin();
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    (!development && origin.protocol !== "https:")
  )
    throw invalidOrigin();

  const authorizeUrl =
    env.EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL ?? defaultAuthorizeUrl;
  const callbackUri = env.EXPO_PUBLIC_RITA_CALLBACK_URI ?? RITA_CALLBACK_URI;
  const isNativeAuthorizeUrl =
    /^rita-id:\/\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)+$/.test(authorizeUrl);
  const nativePair = isNativeAuthorizeUrl && callbackUri === RITA_CALLBACK_URI;
  const expoGoPair =
    isExpoGoLink(authorizeUrl, "oauth/authorize") &&
    isExpoGoLink(callbackUri, "redirect");

  if (!nativePair && !expoGoPair) {
    throw new Error(
      "Configure EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL and EXPO_PUBLIC_RITA_CALLBACK_URI as a matching native pair or an Android Expo Go development pair.",
    );
  }
  if (expoGoPair && (!development || !androidExpoGo)) {
    throw new Error("The configured exp:// OAuth links require Android Expo Go development mode.");
  }
  return { backendOrigin: origin.origin, authorizeUrl, callbackUri };
}

export function getAuthConfig(androidExpoGo: boolean): AuthConfig {
  return readAuthConfig(
    {
      EXPO_PUBLIC_APP_BACKEND_BASE_URL:
        process.env.EXPO_PUBLIC_APP_BACKEND_BASE_URL,
      EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL:
        process.env.EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL,
      EXPO_PUBLIC_RITA_CALLBACK_URI: process.env.EXPO_PUBLIC_RITA_CALLBACK_URI,
    },
    __DEV__,
    androidExpoGo,
  );
}
