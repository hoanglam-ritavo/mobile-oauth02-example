import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthSession, type AuthDependencies } from '../src/services/auth-session';
import { ApiError, ContractError, TransportError } from '../src/services/auth-service';
import type { Handoff } from '../src/services/backend-service';
import type { StoredSession } from '../src/services/session-storage';
import { createNativeAuthSession as webSession } from '../src/services/auth-runtime.web';
import { config, expiry, user } from './fixtures';
const original: StoredSession = { version: 2, sessionKey: 'X', userId: user._id, expiresAt: expiry, backendOrigin: config.backendOrigin };
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup(stored: StoredSession | null = null) {
  let value = stored; let now = Date.parse('2026-10-23T00:00:00Z'); let random = 0;
  const calls = { exchange: 0, handoffs: [] as Handoff[], logout: [] as string[], me: 0, private: 0, writes: [] as StoredSession[] };
  const deps: AuthDependencies = {
    config, now: () => now, random: () => (++random).toString(16).padStart(64, '0'), challenge: async () => 'challenge',
    browser: async url => ({ type: 'success', url: 'rita-id-app://redirect?code=code&state=' + new URL(url).searchParams.get('state') }),
    api: { exchange: async () => { calls.exchange++; return { accessToken: 'oauth-a', refreshToken: 'oauth-r' }; } },
    backend: {
      handoff: async payload => { calls.handoffs.push({ ...payload }); return { sessionKey: 'X', expiresAt: expiry, profile: user }; },
      me: async key => { assert.equal(key, 'X'); calls.me++; return { expiresAt: expiry, profile: user }; },
      logout: async key => { calls.logout.push(key); return true; },
      privateRequest: async (key, _path, _options) => { assert.equal(key, 'X'); calls.private++; return { ok: true }; },
    },
    storage: { load: async () => value, save: async s => { calls.writes.push({ ...s }); value = s; }, clear: async () => { value = null; } },
  };
  return { deps, calls, manager: new AuthSession(deps), value: () => value, advance: (ms: number) => { now += ms; }, now: () => now };
}
test('login hands off once, publishes B profile, and persists only X metadata', async () => {
  const f = setup(); await f.manager.login();
  assert.equal(f.calls.exchange, 1); assert.equal(f.calls.handoffs.length, 1);
  assert.equal(f.calls.handoffs[0].handoffId.length, 64);
  assert.deepEqual(f.value(), original);
  assert.equal(f.manager.state.user?._id, user._id);
  assert.doesNotMatch(JSON.stringify([f.value(), f.manager.state]), /oauth-a|oauth-r|accessToken|refreshToken/);
  await f.manager.authorized('/api/mobile/private/example', { method: 'POST' });
  assert.equal(f.calls.private, 1); await f.manager.logout();
});
for (const error of [new TransportError(), new ApiError(503), new ApiError(429)]) {
  test(`handoff manual retry uses identical payload after ${error.constructor.name}/${error instanceof ApiError ? error.status : 'network'}`, async () => {
    const f = setup(); const handoff = f.deps.backend.handoff;
    let count = 0; let created = 0; const issued = new Map<string, Awaited<ReturnType<typeof handoff>>>();
    f.deps.backend.handoff = async payload => {
      const copy = { ...payload }; f.calls.handoffs.push(copy);
      if (!issued.has(payload.handoffId)) { created++; issued.set(payload.handoffId, { sessionKey: 'X', expiresAt: expiry, profile: user }); }
      if (++count === 1) throw error;
      return issued.get(payload.handoffId)!;
    };
    await f.manager.login(); assert.equal(f.manager.state.status, 'handoff'); assert.equal(f.value(), null);
    assert.equal(count, 1); await f.manager.verify(); assert.equal(count, 1);
    await f.manager.retry(); assert.equal(created, 1); assert.equal(f.calls.exchange, 1);
    assert.deepEqual(f.calls.handoffs[0], f.calls.handoffs[1]);
    assert.equal(f.manager.state.status, 'authenticated'); await f.manager.logout();
  });
}
test('Retry-After enforced, deadline never extended by retry', async () => {
  const f = setup(); let attempts = 0;
  f.deps.backend.handoff = async () => { attempts++; throw new ApiError(429, f.now() + 30_000); };
  await f.manager.login(); await f.manager.retry(); assert.equal(attempts, 1);
  f.advance(30_000); await f.manager.retry(); assert.equal(attempts, 2);
  f.advance(90_000); await f.manager.retry(); assert.equal(attempts, 2);
  assert.equal(f.manager.state.status, 'signedOut');
});
test('timer drops handoff credentials without user interaction', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup(); let retained: Handoff | undefined;
  f.deps.backend.handoff = async payload => { retained = payload; throw new TransportError(); };
  await f.manager.login(); f.advance(120_000); context.mock.timers.tick(120_000);
  assert.equal(f.manager.state.status, 'signedOut'); assert.equal(retained!.refreshToken, '');
  await f.manager.retry(); assert.equal(f.calls.exchange, 1);
});
for (const status of [400, 401, 403, 409]) {
  test(`handoff ${status} ends attempt without retry`, async () => {
    const f = setup(); let count = 0;
    f.deps.backend.handoff = async () => { count++; throw new ApiError(status); };
    await f.manager.login(); await f.manager.retry();
    assert.equal(count, 1); assert.equal(f.manager.state.status, 'signedOut');
  });
}
for (const result of [{ type: 'cancel' }, { type: 'success', url: 'rita-id-app://redirect?state=wrong&code=x' },
  { type: 'success', url: 'rita-id-app://redirect?state=wrong&error=access_denied' }]) {
  test(`browser failure does not exchange or handoff: ${result.type}/${result.url ?? ''}`, async () => {
    const f = setup(); f.deps.browser = async () => result; await f.manager.login();
    assert.equal(f.calls.exchange, 0); assert.equal(f.calls.handoffs.length, 0); assert.equal(f.value(), null);
  });
}
test('concurrent login and retry do not duplicate exchange or handoff', async () => {
  const f = setup(); const gate = deferred<Awaited<ReturnType<typeof f.deps.backend.handoff>>>();
  f.deps.backend.handoff = async () => gate.promise;
  const pending = f.manager.login(); await new Promise(resolve => setImmediate(resolve));
  await f.manager.login(); await f.manager.retry(); assert.equal(f.calls.exchange, 1);
  gate.resolve({ sessionKey: 'X', expiresAt: expiry, profile: user }); await pending; await f.manager.logout();
});
test('logout during handoff rejects late X and closes it at B', async () => {
  const f = setup(); const gate = deferred<Awaited<ReturnType<typeof f.deps.backend.handoff>>>();
  f.deps.backend.handoff = async () => gate.promise;
  const login = f.manager.login(); await new Promise(resolve => setImmediate(resolve));
  await f.manager.logout(); gate.resolve({ sessionKey: 'X', expiresAt: expiry, profile: user }); await login;
  assert.deepEqual(f.calls.logout, ['X']); assert.equal(f.value(), null); assert.equal(f.manager.state.user, null);
});
test('handoff response after deadline is closed and never persisted', async () => {
  const f = setup(); f.deps.backend.handoff = async () => {
    f.advance(120_000); return { sessionKey: 'X', expiresAt: expiry, profile: user };
  };
  await f.manager.login(); assert.deepEqual(f.calls.logout, ['X']); assert.equal(f.value(), null);
});
test('failed X save closes B session and clears local state', async () => {
  const f = setup(); f.deps.storage.save = async () => { throw new Error('write failed'); };
  await f.manager.login(); assert.deepEqual(f.calls.logout, ['X']); assert.equal(f.manager.state.status, 'signedOut');
});
test('failed cleanup blocks login until sign-out succeeds', async () => {
  const f = setup(original); await f.manager.verify();
  const clear = f.deps.storage.clear;
  f.deps.storage.clear = async () => { throw new Error('clear failed'); };
  await f.manager.logout(); assert.equal(f.manager.state.status, 'error'); assert.equal(f.manager.state.user, null);
  await f.manager.login(); assert.equal(f.calls.exchange, 0);
  f.deps.storage.clear = clear; await f.manager.logout(); await f.manager.login();
  assert.equal(f.calls.exchange, 1); await f.manager.logout();
});
test('startup and foreground verify before publishing; network failure retains X and hides identity', async () => {
  const f = setup(original); await f.manager.verify(); assert.equal(f.manager.state.status, 'authenticated');
  const me = f.deps.backend.me; f.deps.backend.me = async () => { throw new TransportError(); };
  await f.manager.verify(); assert.equal(f.manager.state.status, 'unverified'); assert.equal(f.manager.state.user, null);
  assert.deepEqual(f.value(), original); f.deps.backend.me = me; await f.manager.retry();
  assert.equal(f.manager.state.status, 'authenticated'); await f.manager.logout();
});
for (const status of [401, 403, 429, 503]) {
  test(`verification ${status} has correct session semantics`, async () => {
    const f = setup(original); f.deps.backend.me = async () => { throw new ApiError(status); };
    await f.manager.verify(); assert.equal(f.manager.state.status, status === 401 ? 'signedOut' : 'unverified');
    assert.equal(f.value() === null, status === 401); assert.equal(f.calls.exchange, 0); await f.manager.logout();
  });
}
test('wrong origin or expired stored X is never sent anywhere', async () => {
  for (const patch of [{ backendOrigin: 'https://different.invalid' }, { expiresAt: '2020-01-01T00:00:00Z' }]) {
    const f = setup({ ...original, ...patch }); await f.manager.verify();
    assert.equal(f.calls.me, 0); assert.equal(f.value(), null); assert.equal(f.calls.logout.length, 0);
  }
});
test('changed identity or expired server metadata never publishes a profile', async () => {
  for (const result of [{ profile: { ...user, _id: '22345678-1234-4123-8123-123456789012' }, expiresAt: expiry },
    { profile: user, expiresAt: '2020-01-01T00:00:00Z' }]) {
    const f = setup(original); f.deps.backend.me = async () => result; await f.manager.verify();
    assert.equal(f.manager.state.user, null); assert.equal(f.value(), null); assert.deepEqual(f.calls.logout, ['X']);
  }
});
test('read failure hides identity and supports explicit verification retry', async () => {
  const f = setup(original); const load = f.deps.storage.load;
  f.deps.storage.load = async () => { throw new Error('read failed'); };
  await f.manager.verify(); assert.equal(f.manager.state.status, 'unverified'); assert.equal(f.calls.me, 0);
  f.deps.storage.load = load; await f.manager.retry(); assert.equal(f.manager.state.status, 'authenticated'); await f.manager.logout();
});
test('verification coalesces and late response cannot restore logged-out session', async () => {
  const f = setup(original); const gate = deferred<{ profile: typeof user; expiresAt: string }>(); let calls = 0;
  f.deps.backend.me = async () => { calls++; return gate.promise; };
  const first = f.manager.verify(); const second = f.manager.verify(); assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve)); await f.manager.logout();
  gate.resolve({ profile: user, expiresAt: expiry }); await first;
  assert.equal(calls, 1); assert.equal(f.value(), null); assert.equal(f.manager.state.status, 'signedOut');
});
for (const status of [401, 403, 503]) {
  test(`private POST ${status} is never replayed and only 401 ends session`, async () => {
    const f = setup(original); await f.manager.verify();
    f.deps.backend.privateRequest = async () => { f.calls.private++; throw new ApiError(status); };
    await assert.rejects(f.manager.authorized('/api/mobile/private/example', { method: 'POST', body: {} }));
    assert.equal(f.calls.private, 1); assert.equal(f.value() === null, status === 401); await f.manager.logout();
  });
}
for (const outcome of ['401', 'network', 'false']) {
  test(`logout ${outcome} clears local state with accurate revocation feedback`, async () => {
    const f = setup(original); await f.manager.verify();
    f.deps.backend.logout = async () => {
      if (outcome === '401') throw new ApiError(401);
      if (outcome === 'network') throw new TransportError();
      return false;
    };
    await f.manager.logout(); assert.equal(f.value(), null);
    assert.equal(f.manager.state.error === null, outcome === '401');
  });
}
test('web auth runtime remains unsupported', () => assert.throws(() => webSession(), /Android and iOS/));

test('logout during secure-store write serializes deletion after the write and closes X', async () => {
  const f = setup(); const gate = deferred<void>(); const save = f.deps.storage.save;
  f.deps.storage.save = async s => { await gate.promise; await save(s); };
  const login = f.manager.login(); await new Promise(resolve => setImmediate(resolve));
  const logout = f.manager.logout(); gate.resolve(); await Promise.all([login, logout]);
  assert.equal(f.value(), null); assert.equal(f.manager.state.user, null); assert.deepEqual(f.calls.logout, ['X']);
});
test('late storage read after logout cannot revive an internal credential', async () => {
  const f = setup(original); const gate = deferred<StoredSession | null>();
  f.deps.storage.load = async () => gate.promise;
  const verification = f.manager.verify(); await new Promise(resolve => setImmediate(resolve));
  const logout = f.manager.logout(); gate.resolve(original); await Promise.all([verification, logout]);
  await assert.rejects(f.manager.authorized('/api/mobile/private/example'), ApiError);
  assert.equal(f.calls.private, 0); assert.equal(f.calls.me, 0); assert.equal(f.value(), null);
});
test('failed metadata save after verification closes session, rather than publishing identity', async () => {
  const f = setup(original); f.deps.storage.save = async () => { throw new Error('disk'); };
  await f.manager.verify(); assert.equal(f.manager.state.status, 'signedOut');
  assert.equal(f.value(), null); assert.deepEqual(f.calls.logout, ['X']);
});
test('cancel during code exchange never hands off a late token response', async () => {
  const f = setup(); const gate = deferred<{ accessToken: string; refreshToken: string }>();
  f.deps.api.exchange = async () => gate.promise;
  const login = f.manager.login(); await new Promise(resolve => setImmediate(resolve));
  await f.manager.logout(); const tokens = { accessToken: 'oauth-a', refreshToken: 'oauth-r' };
  gate.resolve(tokens); await login;
  assert.equal(f.calls.handoffs.length, 0); assert.equal(tokens.refreshToken, ''); assert.equal(f.value(), null);
});
test('a fresh process cannot resume a handoff from persisted data', async () => {
  const f = setup(); f.deps.backend.handoff = async () => { throw new TransportError(); };
  await f.manager.login(); assert.equal(f.value(), null);
  const restarted = setup(f.value()); await restarted.manager.verify();
  assert.equal(restarted.manager.state.status, 'signedOut'); assert.equal(restarted.calls.handoffs.length, 0);
  await f.manager.logout();
});
test('late private 401 cannot clear a newer login', async () => {
  const f = setup(original); await f.manager.verify();
  const gate = deferred<unknown>(); f.deps.backend.privateRequest = async () => gate.promise;
  const request = f.manager.authorized('/api/mobile/private/example');
  const rejection = assert.rejects(request, ApiError);
  await new Promise(resolve => setImmediate(resolve)); await f.manager.logout(); await f.manager.login();
  gate.reject(new ApiError(401)); await rejection;
  assert.equal(f.manager.state.status, 'authenticated'); await f.manager.logout();
});

test('oversized Retry-After cannot crash UI or extend handoff window', async () => {
  const f = setup(); let count = 0;
  f.deps.backend.handoff = async () => { count++; throw new ApiError(429, 1e30); };
  await f.manager.login(); await f.manager.retry(); assert.equal(count, 1);
  assert.equal(f.manager.state.status, 'handoff'); f.advance(120_000); await f.manager.retry();
  assert.equal(f.manager.state.status, 'signedOut'); assert.equal(count, 1);
});
