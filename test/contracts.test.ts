import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import appConfig from "../app.json";
import { test } from "node:test";
import { RITA_CALLBACK_URI, readAuthConfig } from "../src/constants/config";
import { ApiError, ContractError, TransportError, isExpiry } from "../src/services/auth-service";
import { createBackendApi } from "../src/services/backend-service";
import { authorizeUrl, base64Url, readCallback, randomHex } from "../src/services/oauth-flow";
import { ATTEMPT_KEY, createSessionStorage, SESSION_KEY } from "../src/services/session-storage";
import { redirectSystemPath } from "../src/app/+native-intent";
import { attempt, callback, code, completion, config, grant, pending, refreshExpiry, stored, user } from "./fixtures";

const env = { EXPO_PUBLIC_APP_BACKEND_BASE_URL: config.backendOrigin };

test("public config requires a backend origin and only allows app links for B", () => {
  assert.equal(config.authorizeUrl, "rita-id://oauth/authorize");
  for (const value of ["", "ftp://host", "https:///host", "https://user:pass@host", "https://host/path",
    "https://host?q=x", "https://host#fragment", "https://host?", " https://host", "https://host ", "https://host\\evil"]) {
    assert.throws(() => readAuthConfig({ EXPO_PUBLIC_APP_BACKEND_BASE_URL: value }));
  }
  assert.throws(() => readAuthConfig({ EXPO_PUBLIC_APP_BACKEND_BASE_URL: "http://localhost:3005" }));
  assert.doesNotThrow(() => readAuthConfig({ EXPO_PUBLIC_APP_BACKEND_BASE_URL: "http://10.0.2.2:3005" }, true));
  for (const link of ["https://host/oauth/authorize", "other-app://oauth/authorize", "rita-id://oauth",
    "rita-id://oauth/authorize?state=x", "rita-id://oauth/../authorize", "rita-id://user@oauth/authorize"]) {
    assert.throws(() => readAuthConfig({ ...env, EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL: link }));
  }
});

test("public config accepts Expo Go authorization links only in development", () => {
  for (const link of [
    "exp://10.0.2.2:8081/--/oauth/authorize",
    "exp://localhost:8087/--/oauth/authorize",
    "exp://metro.example.invalid/--/oauth/authorize",
    "exp://[::1]:65535/--/oauth/authorize",
  ]) {
    const mobileEnv = { ...env, EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL: link };
    assert.equal(readAuthConfig(mobileEnv, true).authorizeUrl, link);
    assert.throws(() => readAuthConfig(mobileEnv, false), /rita-id:\/\/oauth\/authorize/);
  }

  assert.equal(readAuthConfig(env, true).authorizeUrl, config.authorizeUrl);
  assert.equal(readAuthConfig({
    ...env,
    EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL: "rita-id://oauth/authorize",
  }, true).authorizeUrl, config.authorizeUrl);
});

test("public config rejects malformed Expo Go authorization links in development", () => {
  const entry = "exp://10.0.2.2:8081/--/oauth/authorize";
  for (const link of [
    "exp://10.0.2.2:8082/--/redirect",
    "exp://10.0.2.2:8081/oauth/authorize",
    "exp:///--/oauth/authorize",
    "exp://metro..example.invalid/--/oauth/authorize",
    "exp://10.0.2.999/--/oauth/authorize",
    "exp://host:/--/oauth/authorize",
    "exp://host:0/--/oauth/authorize",
    "exp://host:65536/--/oauth/authorize",
    "exp://user:pass@host/--/oauth/authorize",
    "exp://host/--/other/../oauth/authorize",
    entry + "?state=example",
    entry + "#preview",
    entry + "\n",
  ]) {
    assert.throws(
      () => readAuthConfig({ ...env, EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL: link }, true),
      /EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL.*Expo Go link/,
      link,
    );
  }
});

test("partner identity and callback match the native app registration", () => {
  assert.equal(appConfig.expo.name, "Rita Partner Demo");
  assert.equal(appConfig.expo.slug, "rita-partner-demo");
  assert.deepEqual(appConfig.expo.platforms, ["android", "ios"]);
  assert.equal(appConfig.expo.android.package, "com.kompact.ritapartnerdemo");
  assert.equal(appConfig.expo.ios.bundleIdentifier, appConfig.expo.android.package);
  assert.equal(RITA_CALLBACK_URI, appConfig.expo.scheme + "://redirect");
});

test("Rita app link carries only C's authorization parameters and PKCE challenge", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = base64Url(createHash("sha256").update(verifier).digest("base64"));
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(randomHex(new Uint8Array(32)).length, 64);
  const url = new URL(authorizeUrl(config.authorizeUrl, attempt, challenge));
  assert.equal(url.protocol, "rita-id:");
  assert.equal(url.host, "oauth");
  assert.equal(url.pathname, "/authorize");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: attempt.clientId, redirect_uri: RITA_CALLBACK_URI, scope: attempt.scope,
    state: attempt.state, response_type: "code", code_challenge: challenge, code_challenge_method: "S256",
  });
});

test("callback requires exact URI, matching state and a single code or error", () => {
  assert.deepEqual(readCallback(callback, attempt.state), { kind: "code", code });
  assert.deepEqual(readCallback(RITA_CALLBACK_URI + "?state=" + attempt.state + "&error=access_denied", attempt.state), { kind: "cancelled" });
  for (const url of [callback.replace("rita-partner-demo", "rita-id-app"), callback.replace("redirect?", "redirect/path?"),
    callback.replace("redirect?", "redirect/?"), callback.replace(attempt.state, "wrong"),
    callback + "&state=again", callback + "&%63ode=a", callback + "&error=access_denied", callback + "#fragment",
    callback.replace("example-code", "%20"), callback.replace("example-code", "%a"), callback.replace("example-code", "%FF"), " " + callback]) {
    assert.equal(readCallback(url, attempt.state), null);
  }
  assert.equal(redirectSystemPath({ path: callback, initial: true }), "/");
  assert.equal(redirectSystemPath({ path: "/redirect?code=x", initial: false }), "/");
  assert.equal(redirectSystemPath({ path: "/login", initial: false }), "/login");
});

test("C wire contract has exact payloads, no cookies, and only the private calls use Bearer", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const api = createBackendApi(config, async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/logout")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/attempts")) return Response.json(attempt, { status: 201 });
    if (String(url).endsWith("/me")) return Response.json({ user: { ...user, ignored: "data" } });
    return Response.json(grant);
  });
  const challenge = "x".repeat(43);
  assert.deepEqual(await api.start(challenge), attempt);
  assert.deepEqual(await api.complete(completion), grant);
  assert.deepEqual(await api.refresh(grant.refreshToken), grant);
  assert.deepEqual(await api.me(grant.accessToken), user);
  await api.privateRequest(grant.accessToken, "/api/mobile/private/example", { method: "POST", body: { value: 1 } });
  await api.logout(grant.refreshToken);
  assert.deepEqual(calls.map(call => call.url), [
    "auth/attempts", "auth/session", "auth/refresh", "me", "private/example", "auth/logout",
  ].map(path => config.backendOrigin + "/api/mobile/" + path));
  assert.deepEqual(calls.map(({ init }) => init.body ? JSON.parse(String(init.body)) : null), [
    { codeChallenge: challenge }, completion, { refreshToken: grant.refreshToken }, null, { value: 1 }, { refreshToken: grant.refreshToken },
  ]);
  for (const [index, { init }] of calls.entries()) {
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), index === 3 || index === 4 ? "Bearer " + grant.accessToken : null);
    assert.equal(headers.has("cookie"), false);
  }
});

test("C validators reject incorrect callback, malformed grants and unexpected /me profile", async () => {
  const api = createBackendApi(config, async () => Response.json({ ...attempt, redirectUri: "other://callback" }));
  await assert.rejects(api.start("challenge"), ContractError);
  for (const raw of [null, {}, { user: { sub: user.id, name: user.name, email: user.email } }]) {
    await assert.rejects(createBackendApi(config, async () => Response.json(raw)).me(grant.accessToken), ContractError);
  }
  for (const value of ["2030-02-30T00:00:00Z", "2030-01-01", "2030-01-01T00:00:00+00:00"]) assert.ok(!isExpiry(value));
  assert.ok(isExpiry(refreshExpiry));
  assert.ok(isExpiry("2030-01-01T00:00:00Z"));
  const calls: string[] = [];
  const bad = createBackendApi(config, async url => {
    calls.push(String(url));
    return String(url).endsWith("/logout")
      ? new Response(null, { status: 204 })
      : Response.json({ ...grant, accessExpiresAt: "2031-01-01T00:00:00Z" });
  });
  await assert.rejects(bad.complete(completion), ContractError);
  assert.deepEqual(calls.map(url => url.split("/").at(-1)), ["session", "logout"]);
  await assert.rejects(createBackendApi(config, async () => Response.json({})).logout(grant.refreshToken), ContractError);
});

test("private paths are constrained before fetch", async () => {
  let calls = 0;
  const api = createBackendApi(config, async () => { calls++; return Response.json({}); });
  for (const path of ["https://other.test", "//other.test", "/api/mobile/../auth", "/api/mobile/%2e%2e/auth",
    "/api/mobile/\\other", "/api/mobile//other", "/api/mobile/auth", "/api/mobile/auth/session", "/api/mobile/me?token=x", "/auth/oauth/userinfo"]) {
    await assert.rejects(api.privateRequest(grant.accessToken, path), ContractError);
  }
  assert.equal(calls, 0);
});

test("transport timeout and API errors preserve only controlled metadata", async () => {
  let calls = 0;
  const api = createBackendApi(config, async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("private"))));
  }, 5);
  await assert.rejects(api.me(grant.accessToken), TransportError);
  assert.equal(calls, 1);
  const busy = createBackendApi(config, async () => Response.json(
    { error: "CAPACITY_EXCEEDED", error_description: "private" }, { status: 503, headers: { "Retry-After": "3" } },
  ));
  await assert.rejects(busy.complete(completion), (error: unknown) =>
    error instanceof ApiError && error.status === 503 && error.code === "CAPACITY_EXCEEDED" &&
    error.retryAt > Date.now() && !error.message.includes("private"));
  const response = Response.json({});
  response.json = async () => { throw new TypeError("private"); };
  await assert.rejects(createBackendApi(config, async () => response).me(grant.accessToken), TransportError);
  await assert.rejects(createBackendApi(config, async () => new Response("{broken")).me(grant.accessToken), ContractError);
});

test("SecureStore has separate allowlists and migrates credentials from the previous demo", async () => {
  const values = new Map<string, string>([["app_backend_session_v2", "old"], ["oauth_refresh_token", "old"]]);
  const storage = createSessionStorage({
    getItemAsync: async key => values.get(key) ?? null, setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async key => { values.delete(key); },
  });
  await storage.migrate();
  assert.equal(values.size, 0);
  await storage.saveSession({ ...stored, ...{ accessToken: grant.accessToken, user } });
  await storage.saveAttempt({ ...pending, ...{ code } });
  assert.deepEqual(await storage.loadSession(), stored);
  assert.deepEqual(await storage.loadAttempt(), pending);
  assert.doesNotMatch(values.get(SESSION_KEY)!, /accessToken|example.invalid.*test/);
  assert.doesNotMatch(values.get(ATTEMPT_KEY)!, /example-code/);
  values.set(SESSION_KEY, JSON.stringify({ ...stored, version: 2 }));
  values.set(ATTEMPT_KEY, JSON.stringify({ ...pending, verifier: "" }));
  assert.equal(await storage.loadSession(), null);
  assert.equal(await storage.loadAttempt(), null);
  assert.equal(values.size, 0);
});

test("cleanup attempts every key even when a deletion fails", async () => {
  const removed: string[] = [];
  const storage = createSessionStorage({
    getItemAsync: async () => null, setItemAsync: async () => {},
    deleteItemAsync: async key => { removed.push(key); if (key === SESSION_KEY) throw new Error("failed"); },
  });
  await assert.rejects(storage.clear());
  assert.deepEqual(removed.sort(), [ATTEMPT_KEY, SESSION_KEY, "app_backend_session_v2", "rita_session_v1",
    "oauth_access_token", "oauth_refresh_token"].sort());
});
