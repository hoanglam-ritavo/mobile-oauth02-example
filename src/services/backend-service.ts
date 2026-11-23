import type { AuthConfig } from "../constants/config";
import { ContractError, createJsonClient, isExpiry, isRecord, isToken, isUuid } from "./auth-service";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
}
export interface LoginAttempt {
  attemptId: string;
  state: string;
  expiresAt: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}
export interface LoginCompletion {
  attemptId: string;
  state: string;
  code: string;
  codeVerifier: string;
}
export interface SessionGrant {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: UserProfile;
}
export interface PrivateRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

function parseUser(value: unknown): UserProfile {
  if (!isRecord(value) || !isUuid(value.id) ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 512 ||
      typeof value.email !== "string" || !value.email.trim() || value.email.length > 320) throw new ContractError();
  return { id: value.id, name: value.name, email: value.email };
}

export function createBackendApi(config: AuthConfig, request: typeof fetch = fetch, timeoutMs = 10_000) {
  const json = createJsonClient(config.backendOrigin, request, timeoutMs);
  const post = (path: string, body: unknown) => json("/api/mobile/auth/" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const bearer = (accessToken: string) => ({ Authorization: "Bearer " + accessToken });

  async function logout(refreshToken: string): Promise<void> {
    if (await post("logout", { refreshToken }) !== undefined) throw new ContractError();
  }

  async function grant(data: unknown): Promise<SessionGrant> {
    if (!isRecord(data) || !isToken(data.refreshToken)) throw new ContractError();
    const refreshToken = data.refreshToken;
    try {
      if (!isToken(data.accessToken) || !isExpiry(data.accessExpiresAt) || !isExpiry(data.refreshExpiresAt) ||
          Date.parse(data.accessExpiresAt) > Date.parse(data.refreshExpiresAt)) throw new ContractError();
      return {
        accessToken: data.accessToken, accessExpiresAt: data.accessExpiresAt,
        refreshToken, refreshExpiresAt: data.refreshExpiresAt, user: parseUser(data.user),
      };
    } catch (error) {
      await logout(refreshToken).catch(() => {});
      throw error;
    }
  }

  return {
    async start(codeChallenge: string): Promise<LoginAttempt> {
      const data = await post("attempts", { codeChallenge });
      if (!isRecord(data) || !isUuid(data.attemptId) || !isToken(data.state) || !isExpiry(data.expiresAt) ||
          typeof data.clientId !== "string" || !/^[\x21-\x7e]{1,256}$/.test(data.clientId) ||
          data.redirectUri !== config.callbackUri || data.scope !== "openid profile email") throw new ContractError();
      return {
        attemptId: data.attemptId, state: data.state, expiresAt: data.expiresAt,
        clientId: data.clientId, redirectUri: data.redirectUri, scope: data.scope,
      };
    },
    async complete(payload: LoginCompletion): Promise<SessionGrant> {
      const { attemptId, state, code, codeVerifier } = payload;
      return grant(await post("session", { attemptId, state, code, codeVerifier }));
    },
    async refresh(refreshToken: string): Promise<SessionGrant> {
      return grant(await post("refresh", { refreshToken }));
    },
    async me(accessToken: string): Promise<UserProfile> {
      const data = await json("/api/mobile/me", { headers: bearer(accessToken) });
      if (!isRecord(data)) throw new ContractError();
      return parseUser(data.user);
    },
    logout,
    async privateRequest(accessToken: string, path: string, options: PrivateRequest = {}): Promise<unknown> {
      if (!/^\/api\/mobile\/[a-zA-Z0-9/_-]+$/.test(path) || path.includes("//") ||
          path === "/api/mobile/auth" || path.startsWith("/api/mobile/auth/")) throw new ContractError();
      const headers: Record<string, string> = bearer(accessToken);
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      if (body !== undefined) headers["Content-Type"] = "application/json";
      return json(path, { method: options.method ?? "GET", headers, body });
    },
  };
}
export type BackendApi = ReturnType<typeof createBackendApi>;
