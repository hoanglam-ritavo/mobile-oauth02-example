import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { ApiError, TransportError } from "../src/services/auth-service";
import { AuthSession, type AuthDependencies } from "../src/services/auth-session";
import type { LoginCompletion, SessionGrant } from "../src/services/backend-service";
import { ATTEMPT_KEY, SESSION_KEY, createSessionStorage } from "../src/services/session-storage";
import { createNativeAuthSession as webSession } from "../src/services/auth-runtime.web";
import { attempt, callback, completion, config, grant, now, pending, refreshExpiry, stored, user, verifier } from "./fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(context: TestContext, values = new Map<string, string>()) {
  let clock = now;
  let onLink: ((url: string) => void) | undefined;
  const opened: string[] = [];
  const starts: string[] = [];
  const completions: LoginCompletion[] = [];
  const refreshes: string[] = [];
  const reads: string[] = [];
  const closed: string[] = [];
  const requests: string[] = [];
  const secondGrant = () => ({
    ...grant, accessToken: "b".repeat(43), refreshToken: "q".repeat(43),
    accessExpiresAt: new Date(Math.min(clock + 15 * 60_000, Date.parse(refreshExpiry))).toISOString(),
  });
  const deps: AuthDependencies = {
    config, now: () => clock, verifier: () => verifier,
    challenge: async value => createHash("sha256").update(value).digest("base64url"),
    storage: createSessionStorage({
      getItemAsync: async key => values.get(key) ?? null,
      setItemAsync: async (key, value) => { values.set(key, value); },
      deleteItemAsync: async key => { values.delete(key); },
    }),
    links: {
      open: async value => { opened.push(value); },
      initial: async () => null,
      subscribe: receive => { onLink = receive; return () => { onLink = undefined; }; },
    },
    backend: {
      start: async challenge => {
        starts.push(challenge);
        return { ...attempt, expiresAt: new Date(clock + 10 * 60_000).toISOString() };
      },
      complete: async payload => { completions.push(payload); return grant; },
      refresh: async token => { refreshes.push(token); return secondGrant(); },
      me: async token => { reads.push(token); return user; },
      logout: async token => { closed.push(token); },
      privateRequest: async token => { requests.push(token); return { ok: true }; },
    },
  };
  const session = new AuthSession(deps);
  context.after(() => session.logout());
  return {
    session, deps, values, opened, starts, completions, refreshes, reads, closed, requests, secondGrant,
    advance: (ms: number) => { clock += ms; },
    deliver: (value: string) => onLink?.(value),
    login: async () => { await session.login(); await session.receiveCallback(callback); },
  };
}

test("persist attempt before opening B; valid callback logs in with only C's refresh token stored", async context => {
  const f = fixture(context);
  const open = f.deps.links.open;
  f.deps.links.open = async value => {
    assert.deepEqual(JSON.parse(f.values.get(ATTEMPT_KEY)!), pending);
    return open(value);
  };
  await f.session.login();
  assert.equal(f.session.state.status, "waiting");
  assert.equal(f.opened.length, 1);
  assert.equal(f.starts[0], createHash("sha256").update(verifier).digest("base64url"));
  assert.doesNotMatch(f.opened[0], new RegExp(verifier));
  await f.session.receiveCallback(callback);
  assert.deepEqual(f.completions, [completion]);
  assert.equal(f.session.state.status, "authenticated");
  assert.deepEqual(f.session.state.user, user);
  assert.deepEqual(JSON.parse(f.values.get(SESSION_KEY)!), stored);
  assert.ok(!f.values.has(ATTEMPT_KEY));
  await f.session.authorized("/api/mobile/me");
  assert.deepEqual(f.requests, [grant.accessToken]);
});

test("wrong state leaves pending attempt intact; concurrent and repeated callbacks complete once", async context => {
  const f = fixture(context);
  await Promise.all([f.session.login(), f.session.login()]);
  assert.equal(f.starts.length, 1);
  await f.session.receiveCallback(callback.replace(attempt.state, "other"));
  assert.equal(f.session.state.status, "waiting");
  assert.ok(f.values.has(ATTEMPT_KEY));
  await Promise.all([f.session.receiveCallback(callback), f.session.receiveCallback(callback)]);
  await f.session.receiveCallback(callback);
  assert.equal(f.completions.length, 1);
});

test("a cold launch with a pending attempt deduplicates initial URL and warm event", async context => {
  const f = fixture(context, new Map([[ATTEMPT_KEY, JSON.stringify(pending)]]));
  const initial = deferred<string>();
  f.deps.links.initial = () => initial.promise;
  const disconnect = f.session.connectLinks();
  f.deliver(callback);
  initial.resolve(callback);
  await f.session.verify();
  await nextTurn();
  assert.equal(f.session.state.status, "authenticated");
  assert.equal(f.starts.length, 0);
  assert.equal(f.completions.length, 1);
  disconnect();
});

test("detached native callback listeners do not deliver a late initial URL", async context => {
  const f = fixture(context, new Map([[ATTEMPT_KEY, JSON.stringify(pending)]]));
  const initial = deferred<string>();
  f.deps.links.initial = () => initial.promise;
  const disconnect = f.session.connectLinks();
  disconnect();
  initial.resolve(callback);
  await f.session.verify();
  await nextTurn();
  assert.equal(f.session.state.status, "waiting");
  assert.equal(f.completions.length, 0);
});

test("matching denial clears the attempt without contacting C and allows a new login", async context => {
  const f = fixture(context);
  await f.session.login();
  await f.session.receiveCallback(attempt.redirectUri + "?state=" + attempt.state + "&error=access_denied");
  assert.equal(f.session.state.status, "cancelled");
  assert.ok(!f.values.has(ATTEMPT_KEY));
  assert.equal(f.completions.length, 0);
  await f.session.login();
  assert.equal(f.session.state.status, "waiting");
});

test("failed app launch discards the attempt", async context => {
  const f = fixture(context);
  f.deps.links.open = async () => { throw new Error("app unavailable"); };
  await f.session.login();
  assert.equal(f.session.state.status, "signedOut");
  assert.match(f.session.state.error!, /Không mở được/);
  assert.equal(f.completions.length, 0);
  assert.equal(f.values.size, 0);
});

for (const patch of [{ backendOrigin: "https://other.example.invalid" }, { expiresAt: new Date(now).toISOString() }]) {
  test("cold callback cannot use an expired or foreign-origin record " + Object.keys(patch)[0], async context => {
    const f = fixture(context, new Map([[ATTEMPT_KEY, JSON.stringify({ ...pending, ...patch })]]));
    await f.session.receiveCallback(callback);
    assert.equal(f.session.state.status, "signedOut");
    assert.equal(f.completions.length, 0);
    assert.equal(f.values.size, 0);
  });
}

test("OS restart after callback processing cannot resume an in-memory completion", async context => {
  const f = fixture(context);
  f.deps.backend.complete = async () => { throw new TransportError(); };
  await f.login();
  assert.equal(f.session.state.status, "handoff");
  assert.equal(f.values.size, 0);
  const restarted = fixture(context, f.values);
  await restarted.session.receiveCallback(callback);
  assert.equal(restarted.session.state.status, "signedOut");
  assert.equal(restarted.completions.length, 0);
});

for (const error of [new TransportError(), new ApiError(503, now + 15_000, "CAPACITY_EXCEEDED")]) {
  test("explicit retry sends identical completion after " + error.constructor.name, async context => {
    const f = fixture(context);
    const requests: LoginCompletion[] = [];
    f.deps.backend.complete = async value => {
      requests.push(value);
      if (requests.length === 1) throw error;
      return grant;
    };
    await f.login();
    assert.equal(f.session.state.status, "handoff");
    await f.session.verify();
    assert.equal(requests.length, 1);
    if (error instanceof ApiError) {
      await f.session.retry();
      assert.equal(requests.length, 1);
      f.advance(15_000);
    }
    await f.session.retry();
    assert.deepEqual(requests, [completion, completion]);
    assert.equal(f.session.state.status, "authenticated");
  });
}

test("login retry deadline is fixed even if Retry-After exceeds the remaining window", async context => {
  const f = fixture(context);
  let calls = 0;
  f.deps.backend.complete = async () => { calls++; throw new ApiError(503, 1e30, "CAPACITY_EXCEEDED"); };
  await f.login();
  f.advance(59_999);
  await f.session.retry();
  assert.equal(calls, 1);
  f.advance(1);
  await f.session.retry();
  assert.equal(calls, 1);
  assert.equal(f.session.state.status, "signedOut");
});

test("a Rita retry prohibition ends the attempt even on HTTP 503", async context => {
  const f = fixture(context);
  let calls = 0;
  f.deps.backend.complete = async () => { calls++; throw new ApiError(503, 0, "RITA_LOGIN_RESTART_REQUIRED"); };
  await f.login();
  await f.session.retry();
  assert.equal(calls, 1);
  assert.equal(f.session.state.status, "signedOut");
});

test("expired completion response is revoked instead of being stored", async context => {
  const f = fixture(context);
  const response = deferred<SessionGrant>();
  f.deps.backend.complete = () => response.promise;
  await f.session.login();
  const login = f.session.receiveCallback(callback);
  await nextTurn();
  f.advance(60_000);
  response.resolve(grant);
  await login;
  assert.deepEqual(f.closed, [grant.refreshToken]);
  assert.equal(f.session.state.status, "signedOut");
});

test("logout during completion rejects and closes a late session", async context => {
  const f = fixture(context);
  const response = deferred<SessionGrant>();
  f.deps.backend.complete = () => response.promise;
  await f.session.login();
  const login = f.session.receiveCallback(callback);
  await nextTurn();
  await f.session.logout();
  response.resolve(grant);
  await login;
  assert.deepEqual(f.closed, [grant.refreshToken]);
  assert.equal(f.values.size, 0);
  assert.equal(f.session.state.status, "signedOut");
});

test("logout waits for a running secure-store save and cleans the late token", async context => {
  const f = fixture(context);
  const save = f.deps.storage.saveSession;
  const saving = deferred<void>();
  const proceed = deferred<void>();
  f.deps.storage.saveSession = async value => { saving.resolve(); await proceed.promise; await save(value); };
  const login = f.login();
  await saving.promise;
  const logout = f.session.logout();
  proceed.resolve();
  await Promise.all([login, logout]);
  assert.deepEqual(f.closed, [grant.refreshToken]);
  assert.equal(f.values.size, 0);
  assert.equal(f.session.state.status, "signedOut");
});

test("secure-store cleanup failure blocks a new login until deletion succeeds", async context => {
  const f = fixture(context);
  await f.login();
  const clear = f.deps.storage.clear;
  f.deps.storage.clear = async () => { throw new Error("unable to delete"); };
  await f.session.logout();
  await f.session.login();
  assert.equal(f.session.state.status, "error");
  assert.equal(f.starts.length, 1);
  f.deps.storage.clear = clear;
  await f.session.logout();
  await f.session.login();
  assert.equal(f.session.state.status, "waiting");
});

test("cold verification refreshes once, saves replacement and checks /me before publishing", async context => {
  const f = fixture(context, new Map([[SESSION_KEY, JSON.stringify(stored)]]));
  const reading = deferred<UserProfile>();
  type UserProfile = typeof user;
  f.deps.backend.me = async token => { f.reads.push(token); return reading.promise; };
  const verify = Promise.all([f.session.verify(), f.session.verify()]);
  await nextTurn();
  assert.equal(f.session.state.user, null);
  assert.deepEqual(f.refreshes, [grant.refreshToken]);
  assert.deepEqual(f.reads, [f.secondGrant().accessToken]);
  assert.equal(JSON.parse(f.values.get(SESSION_KEY)!).refreshToken, f.secondGrant().refreshToken);
  reading.resolve(user);
  await verify;
  assert.equal(f.session.state.status, "authenticated");
});

test("foreign or expired stored sessions never send a refresh token to C", async context => {
  const f = fixture(context, new Map([[SESSION_KEY, JSON.stringify({ ...stored, backendOrigin: "https://other.example.invalid" })]]));
  await f.session.verify();
  assert.equal(f.refreshes.length, 0);
  assert.equal(f.values.size, 0);
  const expired = fixture(context, new Map([[SESSION_KEY, JSON.stringify({ ...stored, refreshExpiresAt: new Date(now).toISOString() })]]));
  await expired.session.verify();
  assert.equal(expired.refreshes.length, 0);
});

test("profile verification mismatch closes the newly restored session", async context => {
  const f = fixture(context, new Map([[SESSION_KEY, JSON.stringify(stored)]]));
  f.deps.backend.me = async () => ({ ...user, id: "a45e6c29-f1b4-40f1-bac7-2d0582936375" });
  await f.session.verify();
  assert.deepEqual(f.closed, [f.secondGrant().refreshToken]);
  assert.equal(f.session.state.status, "signedOut");
});

test("concurrent business requests coalesce rotation and use the saved replacement", async context => {
  const f = fixture(context);
  await f.login();
  f.advance(15 * 60_000 - 10_000);
  await Promise.all([f.session.authorized("/api/mobile/me"), f.session.authorized("/api/mobile/me")]);
  assert.deepEqual(f.refreshes, [grant.refreshToken]);
  assert.deepEqual(f.requests, [f.secondGrant().accessToken, f.secondGrant().accessToken]);
  assert.equal(JSON.parse(f.values.get(SESSION_KEY)!).refreshToken, f.secondGrant().refreshToken);
});

test("uncertain refresh is not retried and no business request is sent", async context => {
  const f = fixture(context);
  await f.login();
  f.advance(15 * 60_000);
  let refreshes = 0;
  f.deps.backend.refresh = async () => { refreshes++; throw new TransportError(); };
  await assert.rejects(f.session.authorized("/api/mobile/me"));
  await f.session.retry();
  assert.equal(refreshes, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(f.session.state.status, "signedOut");
  assert.equal(f.values.size, 0);
});

test("logout during refresh closes both the known credential and late replacement", async context => {
  const f = fixture(context);
  await f.login();
  f.advance(15 * 60_000);
  const rotating = deferred<SessionGrant>();
  f.deps.backend.refresh = () => rotating.promise;
  const rejected = assert.rejects(f.session.authorized("/api/mobile/me"));
  await nextTurn();
  await f.session.logout();
  rotating.resolve(f.secondGrant());
  await rejected;
  assert.deepEqual(f.closed, [grant.refreshToken, f.secondGrant().refreshToken]);
  assert.equal(f.session.state.status, "signedOut");
  assert.equal(f.values.size, 0);
});

for (const status of [401, 403, 503]) {
  test("private POST " + status + " is never replayed and only 401 ends the session", async context => {
    const f = fixture(context);
    await f.login();
    let calls = 0;
    f.deps.backend.privateRequest = async () => { calls++; throw new ApiError(status, 0); };
    await assert.rejects(f.session.authorized("/api/mobile/private/example", { method: "POST", body: {} }));
    assert.equal(calls, 1);
    assert.equal(f.session.state.status, status === 401 ? "signedOut" : "authenticated");
  });
}

test("late 401 from an older access token does not clear a rotated session", async context => {
  const f = fixture(context);
  await f.login();
  const response = deferred<unknown>();
  f.deps.backend.privateRequest = token => token === grant.accessToken ? response.promise : Promise.resolve({ ok: true });
  const rejected = assert.rejects(f.session.authorized("/api/mobile/me"));
  await nextTurn();
  f.advance(15 * 60_000);
  await f.session.authorized("/api/mobile/me");
  response.reject(new ApiError(401, 0));
  await rejected;
  assert.equal(f.session.state.status, "authenticated");
  assert.equal(f.values.size, 1);
});

test("temporary /me failure retains the current refresh token and allows manual verification", async context => {
  const f = fixture(context);
  await f.login();
  const me = f.deps.backend.me;
  f.deps.backend.me = async () => { throw new TransportError(); };
  await f.session.verify();
  assert.equal(f.session.state.status, "unverified");
  assert.ok(f.values.has(SESSION_KEY));
  f.deps.backend.me = me;
  await f.session.retry();
  assert.equal(f.session.state.status, "authenticated");
});

test("logout network failure still clears local storage and reports uncertain revocation", async context => {
  const f = fixture(context);
  await f.login();
  f.deps.backend.logout = async () => { throw new TransportError(); };
  await f.session.logout();
  assert.match(f.session.state.error!, /Chưa xác nhận/);
  assert.equal(f.values.size, 0);
  assert.equal(f.session.state.status, "signedOut");
});

test("web sign-in remains unavailable", () => assert.throws(() => webSession(), /Android and iOS/));
