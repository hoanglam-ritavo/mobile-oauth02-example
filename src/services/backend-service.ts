import type { AuthConfig } from "../constants/config";
import {
  ContractError,
  createJsonClient,
  isExpiry,
  isRecord,
  isToken,
  parseProfile,
  type Tokens,
} from "./auth-service";

export interface Handoff extends Tokens {
  handoffId: string;
  clientId: string;
}
export interface PrivateRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}
export function createBackendApi(
  config: AuthConfig,
  request: typeof fetch = fetch,
  timeoutMs = 10_000,
) {
  const json = createJsonClient(config.backendOrigin, request, timeoutMs);
  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
  const identity = (data: unknown) => {
    if (!isRecord(data) || !isExpiry(data.expiresAt)) throw new ContractError();
    return { profile: parseProfile(data.profile), expiresAt: data.expiresAt };
  };
  return {
    async handoff(payload: Handoff) {
      const data = await json("/api/mobile/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!isRecord(data) || !isToken(data.sessionKey))
        throw new ContractError();
      // A known key must be closed even if the rest of the response is malformed.
      try {
        return { ...identity(data), sessionKey: data.sessionKey };
      } catch (error) {
        await json("/api/mobile/auth/logout", {
          method: "POST",
          headers: bearer(data.sessionKey),
        }).catch(() => undefined);
        throw error;
      }
    },
    async me(key: string) {
      return identity(await json("/api/mobile/me", { headers: bearer(key) }));
    },
    async logout(key: string) {
      const data = await json("/api/mobile/auth/logout", {
        method: "POST",
        headers: bearer(key),
      });
      if (
        !isRecord(data) ||
        data.loggedOut !== true ||
        typeof data.revokeConfirmed !== "boolean"
      )
        throw new ContractError();
      return data.revokeConfirmed;
    },
    async privateRequest(
      key: string,
      path: string,
      options: PrivateRequest = {},
    ): Promise<unknown> {
      // Restrict this helper to mobile resources, including normalized/encoded paths.
      if (
        !/^\/api\/mobile\/[a-zA-Z0-9/_-]+$/.test(path) ||
        path.includes("//") ||
        path.startsWith("/api/mobile/auth/")
      )
        throw new ContractError();
      return json(path, {
        method: options.method ?? "GET",
        headers: {
          ...bearer(key),
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
    },
  };
}
export type BackendApi = ReturnType<typeof createBackendApi>;
