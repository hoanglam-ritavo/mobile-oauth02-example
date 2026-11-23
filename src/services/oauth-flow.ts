import type { LoginAttempt } from "./backend-service";

export const isVerifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);

export function authorizeUrl(entry: string, attempt: LoginAttempt, challenge: string): string {
  const query = new URLSearchParams({
    client_id: attempt.clientId, redirect_uri: attempt.redirectUri, scope: attempt.scope,
    state: attempt.state, response_type: "code", code_challenge: challenge, code_challenge_method: "S256",
  });
  return entry + "?" + query.toString();
}

type Callback = { kind: "code"; code: string } | { kind: "cancelled" };

export function readCallback(value: string, state: string, callbackUri: string): Callback | null {
  if (!value.startsWith(callbackUri + "?") || /[\x00-\x20\x7f#\\]/.test(value) ||
      /%(?![0-9a-f]{2})/i.test(value)) return null;
  // The native URLSearchParams implementation exposes unique keys and can throw on invalid UTF-8.
  const query = new Map<string, string>();
  try {
    for (const field of value.slice(callbackUri.length + 1).split("&")) {
      const separator = field.indexOf("=");
      if (separator <= 0) return null;
      const key = decodeURIComponent(field.slice(0, separator).replace(/\+/g, " "));
      const content = decodeURIComponent(field.slice(separator + 1).replace(/\+/g, " "));
      if (query.has(key)) return null;
      query.set(key, content);
    }
  } catch {
    return null;
  }
  if (query.get("state") !== state) return null;
  const code = query.get("code");
  const error = query.get("error");
  if (error !== undefined) {
    return code === undefined && /^[a-z_]{1,64}$/.test(error) ? { kind: "cancelled" } : null;
  }
  return code && /^[\x21-\x7e]{1,512}$/.test(code) ? { kind: "code", code } : null;
}

export const base64Url = (value: string) => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
