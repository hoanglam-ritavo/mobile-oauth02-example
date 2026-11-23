import { readAuthConfig, RITA_CALLBACK_URI } from "../src/constants/config";
import type { LoginAttempt, SessionGrant } from "../src/services/backend-service";
import type { StoredAttempt, StoredSession } from "../src/services/session-storage";

export const config = readAuthConfig({ EXPO_PUBLIC_APP_BACKEND_BASE_URL: "https://app.example.invalid" });
export const expoGoConfig = readAuthConfig({
  EXPO_PUBLIC_APP_BACKEND_BASE_URL: config.backendOrigin,
  EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL: "exp://10.0.2.2:8081/--/oauth/authorize",
  EXPO_PUBLIC_RITA_CALLBACK_URI: "exp://10.0.2.2:8082/--/redirect",
}, true, true);
export const now = Date.parse("2030-01-01T00:00:00Z");
export const accessExpiry = new Date(now + 15 * 60_000).toISOString();
export const refreshExpiry = new Date(now + 24 * 60 * 60_000).toISOString();
export const verifier = "a".repeat(64);
export const code = "example-code";
export const user = { id: "12345678-1234-4123-8123-123456789012", name: "Test", email: "test@example.invalid" };
export const attempt: LoginAttempt = {
  attemptId: "ef64b237-4646-4c62-824f-9df79953e5c9",
  state: "s".repeat(43),
  expiresAt: new Date(now + 10 * 60_000).toISOString(),
  clientId: "confidential-client-id", redirectUri: RITA_CALLBACK_URI, scope: "openid profile email",
};
export const callback = RITA_CALLBACK_URI + "?state=" + attempt.state + "&code=" + code;
export const pending: StoredAttempt = {
  version: 2, attemptId: attempt.attemptId, state: attempt.state, verifier,
  expiresAt: attempt.expiresAt, backendOrigin: config.backendOrigin, callbackUri: config.callbackUri,
};
export const completion = { attemptId: attempt.attemptId, state: attempt.state, code, codeVerifier: verifier };
export const grant: SessionGrant = {
  accessToken: "a".repeat(43), accessExpiresAt: accessExpiry,
  refreshToken: "r".repeat(43), refreshExpiresAt: refreshExpiry, user,
};
export const stored: StoredSession = {
  version: 3, refreshToken: grant.refreshToken, refreshExpiresAt: refreshExpiry,
  userId: user.id, backendOrigin: config.backendOrigin,
};
