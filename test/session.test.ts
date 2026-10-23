import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthSession, type AuthDependencies } from '../src/services/auth-session';
import { ApiError, type UserProfile } from '../src/services/auth-service';
import type { StoredSession } from '../src/services/session-storage';
import { createNativeAuthSession as webSession } from '../src/services/auth-runtime.web';

const user: UserProfile = {
  _id: '12345678-1234-4123-8123-123456789012', name: 'Test', email: 'test@example.invalid',
  employee_id: null, phone_number: null, is_developer: false, groups: 'EMPLOYEE',
};
const original: StoredSession = { version: 1, userId: user._id, accessToken: 'old', refreshToken: 'old-refresh' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup(stored: StoredSession | null = { ...original }) {
  let value = stored;
  let time = 0;
  const calls = { refresh: 0, profile: [] as string[], logout: [] as string[], exchange: 0, browser: 0, writes: 0 };
  const deps: AuthDependencies = {
    config: { apiUrl: 'http://api.test', portalUrl: 'http://portal.test', clientId: 'client', redirectUri: 'ritaidapp://redirect' },
    storage: {
      load: async () => value,
      save: async session => { calls.writes++; value = session; },
      clear: async () => { value = null; },
    },
    api: {
      exchange: async () => { calls.exchange++; return { accessToken: 'new', refreshToken: 'new-refresh' }; },
      profile: async token => { calls.profile.push(token); return { ...user }; },
      refresh: async () => { calls.refresh++; return { accessToken: 'new', refreshToken: 'new-refresh' }; },
      logout: async token => { calls.logout.push(token); },
    },
    random: () => 'a'.repeat(64), challenge: async () => 'challenge', now: () => time,
    browser: async url => {
      calls.browser++;
      return { type: 'success', url: 'ritaidapp://redirect?code=code&state=' + new URL(url).searchParams.get('state') };
    },
  };
  return { deps, calls, manager: new AuthSession(deps), value: () => value, advance: (ms: number) => { time += ms; } };
}
test('restore and foreground verify before exposing identity; network failure retains credentials', async () => {
  const f = setup();
  await f.manager.verify();
  assert.equal(f.manager.state.status, 'authenticated');
  f.deps.api.profile = async () => { throw new ApiError(503); };
  await f.manager.verify();
  assert.equal(f.manager.state.status, 'unverified');
  assert.equal(f.manager.state.user, null);
  assert.deepEqual(f.value(), original);
  assert.equal(f.calls.refresh, 0);
  f.deps.api.profile = async () => user;
  await f.manager.verify();
  assert.equal(f.manager.state.status, 'authenticated');
});
test('401 rotates once and verifies account before storing the new pair', async () => {
  const f = setup();
  f.deps.api.profile = async token => { if (token === 'old') throw new ApiError(401); return user; };
  await f.manager.verify();
  assert.equal(f.calls.refresh, 1);
  assert.equal(f.manager.state.user?._id, user._id);
  assert.equal(f.value()?.refreshToken, 'new-refresh');
});
test('parallel protected requests share a single rotation and each retries only once', async () => {
  const f = setup();
  await f.manager.verify();
  const gate = deferred<{ accessToken: string; refreshToken: string }>();
  f.deps.api.refresh = async () => { f.calls.refresh++; return gate.promise; };
  const seen: string[] = [];
  const operation = async (token: string) => { seen.push(token); if (token === 'old') throw new ApiError(401); return 'ok'; };
  const first = f.manager.authorized(operation);
  const second = f.manager.authorized(operation);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.calls.refresh, 1);
  gate.resolve({ accessToken: 'new', refreshToken: 'new-refresh' });
  assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);
  assert.deepEqual(seen, ['old', 'old', 'new', 'new']);
});
test('a delayed 401 does not rotate again even when the replacement access JWT is identical', async () => {
  const f = setup();
  await f.manager.verify();
  f.deps.api.refresh = async () => { f.calls.refresh++; return { accessToken: 'old', refreshToken: 'new-refresh' }; };
  const late = deferred<string>();
  let attempts = 0;
  const pending = f.manager.authorized(async () => ++attempts === 1 ? late.promise : 'late-ok');
  let immediate = 0;
  await f.manager.authorized(async () => { if (++immediate === 1) throw new ApiError(401); return 'ok'; });
  late.reject(new ApiError(401));
  assert.equal(await pending, 'late-ok');
  assert.equal(f.calls.refresh, 1);
});
for (const failure of ['timeout', 'rejected', 'changed-account', 'storage', 'second-401']) {
  test(`refresh failure (${failure}) clears session without retrying rotation`, async () => {
    const f = setup();
    await f.manager.verify();
    if (failure === 'timeout' || failure === 'rejected') f.deps.api.refresh = async () => {
      f.calls.refresh++; throw failure === 'timeout' ? new Error('lost-response') : new ApiError(401);
    };
    if (failure === 'changed-account') f.deps.api.profile = async () => ({ ...user, _id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (failure === 'storage') f.deps.storage.save = async () => { throw new Error('disk'); };
    let attempts = 0;
    await assert.rejects(f.manager.authorized(async () => { attempts++; throw new ApiError(401); }));
    assert.equal(f.calls.refresh, 1);
    assert.ok(attempts <= 2);
    assert.equal(f.value(), null);
    assert.equal(f.manager.state.user, null);
    assert.equal(f.manager.state.status, 'signedOut');
  });
}
test('logout waits for rotation and revokes the newest token without restoring identity', async () => {
  const f = setup();
  await f.manager.verify();
  const gate = deferred<{ accessToken: string; refreshToken: string }>();
  f.deps.api.refresh = async () => gate.promise;
  const pending = f.manager.authorized(async () => { throw new ApiError(401); }).catch(() => undefined);
  await new Promise<void>(resolve => setImmediate(resolve));
  const logout = f.manager.logout();
  await f.manager.login();
  assert.equal(f.calls.browser, 0);
  gate.resolve({ accessToken: 'new', refreshToken: 'new-refresh' });
  await Promise.all([pending, logout]);
  assert.deepEqual(f.calls.logout, ['new-refresh']);
  assert.equal(f.value(), null);
  assert.equal(f.manager.state.status, 'signedOut');
});
test('logout clears local data on remote failure and offers recovery on storage failure', async () => {
  const f = setup();
  await f.manager.verify();
  f.deps.api.logout = async () => { throw new Error('network'); };
  await f.manager.logout();
  assert.equal(f.value(), null);
  assert.match(f.manager.state.error!, /could not be confirmed/);
  const g = setup();
  await g.manager.verify();
  g.deps.storage.clear = async () => { throw new Error('storage unavailable'); };
  await g.manager.logout();
  assert.equal(g.manager.state.status, 'error');
  assert.equal(g.manager.state.user, null);
  await g.manager.login();
  assert.equal(g.calls.browser, 0);
  g.deps.storage.clear = async () => {};
  await g.manager.logout();
  assert.equal(g.manager.state.status, 'signedOut');
});
test('late browser callback cannot sign in after logout and duplicate login opens once', async () => {
  const f = setup(null);
  const gate = deferred<{ type: string; url?: string }>();
  f.deps.browser = async () => { f.calls.browser++; return gate.promise; };
  const login = f.manager.login();
  await new Promise<void>(resolve => setImmediate(resolve));
  await f.manager.login();
  assert.equal(f.calls.browser, 1);
  await f.manager.logout();
  gate.resolve({ type: 'success', url: 'ritaidapp://redirect?code=code&state=' + 'a'.repeat(64) });
  await login;
  assert.equal(f.calls.exchange, 0);
  assert.equal(f.value(), null);
  assert.equal(f.manager.state.status, 'signedOut');
});
test('login stores only after userinfo; cancellation, expiry and profile errors create no session', async () => {
  const f = setup(null);
  await f.manager.login();
  assert.equal(f.manager.state.status, 'authenticated');
  assert.equal(f.calls.writes, 1);
  assert.deepEqual(Object.keys(f.value()!).sort(), ['accessToken', 'refreshToken', 'userId', 'version']);
  for (const reason of ['cancel', 'expire', 'profile']) {
    const g = setup(null);
    if (reason === 'cancel') g.deps.browser = async () => ({ type: 'cancel' });
    if (reason === 'expire') {
      const browser = g.deps.browser;
      g.deps.browser = async (...args) => { g.advance(600_001); return browser(...args); };
    }
    if (reason === 'profile') g.deps.api.profile = async () => { throw new ApiError(500); };
    await g.manager.login();
    assert.equal(g.value(), null);
    assert.equal(g.calls.writes, 0);
    assert.equal(g.manager.state.status, reason === 'cancel' ? 'cancelled' : 'signedOut');
  }
});
test('logout serializes deletion after a pending secure-store write', async () => {
  const f = setup(null);
  const gate = deferred<void>();
  const save = f.deps.storage.save;
  f.deps.storage.save = async value => { await gate.promise; await save(value); };
  const login = f.manager.login();
  await new Promise<void>(resolve => setImmediate(resolve));
  const logout = f.manager.logout();
  gate.resolve();
  await Promise.all([login, logout]);
  assert.equal(f.value(), null);
  assert.equal(f.manager.state.user, null);
});
test('restoring the wrong identity clears stored credentials', async () => {
  const f = setup();
  f.deps.api.profile = async () => ({ ...user, _id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  await f.manager.verify();
  assert.equal(f.value(), null);
  assert.equal(f.manager.state.user, null);
});
test('web adapter does not load any native auth or storage implementation', () => {
  assert.throws(() => webSession(), /Android and iOS only/);
});

test('switching accounts replaces UUID and credentials only after successful validation', async () => {
  const f = setup();
  await f.manager.verify();
  await f.manager.logout();
  const other = { ...user, _id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Other' };
  f.deps.api.profile = async () => other;
  await f.manager.login();
  assert.equal(f.value()?.userId, other._id);
  assert.equal(f.manager.state.user?.name, 'Other');
  assert.deepEqual(f.calls.logout, ['old-refresh']);
});

test('logout during restore prevents late profile or storage results exposing a user', async () => {
  const f = setup();
  const gate = deferred<UserProfile>();
  f.deps.api.profile = async () => gate.promise;
  const verify = f.manager.verify();
  await new Promise<void>(resolve => setImmediate(resolve));
  await f.manager.logout();
  gate.resolve(user);
  await verify;
  assert.equal(f.manager.state.status, 'signedOut');
  assert.equal(f.manager.state.user, null);
  assert.equal(f.value(), null);
});
