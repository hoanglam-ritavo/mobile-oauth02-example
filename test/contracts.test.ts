import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readAuthConfig } from '../src/constants/config';
import { ApiError, ContractError, createAuthApi, parseProfile } from '../src/services/auth-service';
import { authorizeUrl, base64Url, consumeCallback, randomHex } from '../src/services/oauth-flow';
import { createSessionStorage, SESSION_KEY } from '../src/services/session-storage';

export const env = {
  EXPO_PUBLIC_RITA_BASE_URL: 'http://localhost:3002', EXPO_PUBLIC_OAUTH_CLIENT_ID: 'test-client',
};
const config = readAuthConfig(env);
export const profile = {
  _id: '12345678-1234-4123-8123-123456789012', name: 'Test User', email: 'test@example.invalid',
  employee_id: null, phone_number: null, is_developer: false, groups: 'EMPLOYEE' as const,
};
test('configuration requires explicit origins/client and rejects unsafe or legacy settings', () => {
  assert.equal(config.redirectUri, 'rita-id-app://redirect');
  assert.equal(readAuthConfig({ ...env, EXPO_PUBLIC_OAUTH_REDIRECT_URI: 'rita-id-app://redirect' }).redirectUri, config.redirectUri);
  assert.throws(() => readAuthConfig({ ...env, EXPO_PUBLIC_OAUTH_REDIRECT_URI: 'ritaidapp://redirect' }));
  for (const key of Object.keys(env)) assert.throws(() => readAuthConfig({ ...env, [key]: '' }));
  for (const value of ['ftp://host', 'https://user:pass@host', 'https://host/path', 'https://host?q=x', 'http://<HOST>:4000', 'https://host/api', 'https://host#fragment', 'https://host?', 'https://host#', ' https://host', 'https://host ']) {
    assert.throws(() => readAuthConfig({ ...env, EXPO_PUBLIC_RITA_BASE_URL: value }));
  }
  assert.throws(() => readAuthConfig({ EXPO_PUBLIC_OAUTH_CLIENT_ID: 'client', EXPO_PUBLIC_OAUTH_AUTH_URL: 'http://old' }));
  assert.throws(() => readAuthConfig({ ...env, EXPO_PUBLIC_OAUTH_REDIRECT_URI: 'other://redirect' }));
});
test('one origin derives portal and API URLs without legacy fallback', async () => {
  assert.throws(() => readAuthConfig({ EXPO_PUBLIC_OAUTH_CLIENT_ID: 'client', EXPO_PUBLIC_RITA_API_URL: 'https://old.test/api', EXPO_PUBLIC_RITA_PORTAL_URL: 'https://old.test' }), /EXPO_PUBLIC_RITA_BASE_URL/);
  for (const [input, expected] of [
    ['http://192.168.1.10:3002', 'http://192.168.1.10:3002'],
    ['http://192.168.1.10:3002/', 'http://192.168.1.10:3002'],
    ['https://id.example.com', 'https://id.example.com'],
    ['https://id.example.com/', 'https://id.example.com'],
    ['https://id.example.com:8443/', 'https://id.example.com:8443'],
  ]) {
    const settings = readAuthConfig({ ...env, EXPO_PUBLIC_RITA_BASE_URL: input });
    assert.equal(settings.portalUrl, expected);
    assert.equal(settings.apiUrl, expected + '/api');
    assert.equal(authorizeUrl(settings, 'state', 'challenge'), expected + '/oauth/authorize?client_id=test-client&redirect_uri=rita-id-app%3A%2F%2Fredirect&response_type=code&scope=openid+profile+email&state=state&code_challenge=challenge&code_challenge_method=S256');
    const urls: string[] = [];
    const api = createAuthApi(settings, async url => {
      urls.push(String(url));
      if (String(url).endsWith('/userinfo')) return Response.json(profile);
      if (String(url).endsWith('/token')) return Response.json({ access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 300 });
      return Response.json({ success: true, accessToken: 'a', refreshToken: 'r' });
    });
    await api.exchange('code', 'verifier');
    await api.profile('a');
    await api.refresh('r');
    await api.logout('r');
    assert.deepEqual(urls, ['/api/auth/oauth/token', '/api/auth/oauth/userinfo', '/api/auth/refresh', '/api/auth/logout'].map(path => expected + path));
  }
});
test('PKCE encoding and authorize contract', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = base64Url(createHash('sha256').update(verifier).digest('base64'));
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(randomHex(new Uint8Array(32)).length, 64);
  const url = new URL(authorizeUrl(config, 'state', challenge));
  assert.equal(url.origin, config.portalUrl);
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(url.searchParams.has('client_secret'), false);
});
test('callback requires exact target, one-use unexpired state and unique query fields', () => {
  const pending = () => ({ state: 'state', verifier: 'verifier', expiresAt: 100, used: false });
  const attempt = pending();
  assert.equal(consumeCallback('rita-id-app://redirect?state=state&code=code', config.redirectUri, attempt, 0), 'code');
  assert.throws(() => consumeCallback('rita-id-app://redirect?state=state&code=code', config.redirectUri, attempt, 0));
  for (const url of [
    'ritaidapp://redirect?state=state&code=code',
    'other://redirect?state=state&code=code', 'rita-id-app://wrong?state=state&code=code',
    'rita-id-app://redirect/path?state=state&code=code', 'rita-id-app://redirect?state=wrong&error=denied',
    'rita-id-app://redirect?state=state&error=denied', 'rita-id-app://redirect?state=state',
    'rita-id-app://redirect?state=state&state=state&code=code',
    'rita-id-app://redirect?state=state&code=a&code=b', 'rita-id-app://redirect?state=state&code=x#fragment',
  ]) assert.throws(() => consumeCallback(url, config.redirectUri, pending(), 0));
  assert.throws(() => consumeCallback('rita-id-app://redirect?state=state&code=x', config.redirectUri, pending(), 100));
});
test('userinfo checks seven fields and permits all groups without developer eligibility filtering', () => {
  for (const groups of ['EMPLOYEE', 'CUSTOMER', 'ENTERPRISE']) {
    assert.deepEqual(parseProfile({ ...profile, groups, ignored: 'discard' }), { ...profile, groups });
  }
  assert.equal(parseProfile({ ...profile, is_developer: true }).is_developer, true);
  assert.equal(parseProfile({ ...profile, employee_id: 'E123', phone_number: '123' }).employee_id, 'E123');
  for (const key of Object.keys(profile)) {
    assert.throws(() => parseProfile({ ...profile, [key]: undefined }), ContractError);
    assert.throws(() => parseProfile({ ...profile, [key]: 42 }), ContractError);
  }
  for (const value of [null, [], { ...profile, groups: 'DEVELOPER' }, { ...profile, _id: undefined, sub: profile._id }]) {
    assert.throws(() => parseProfile(value), ContractError);
  }
});
test('HTTP uses current endpoints, validates response shapes and omits cookies/secrets', async () => {
  const calls: { path: string; url: string; init: RequestInit }[] = [];
  const api = createAuthApi(config, async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, url: String(url), init });
    if (path.endsWith('/userinfo')) return Response.json(profile);
    if (path.endsWith('/token')) return Response.json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 300, id_token: 'discard' });
    if (path.endsWith('/refresh')) return Response.json({ success: true, accessToken: 'new-access', refreshToken: 'new-refresh' });
    return Response.json({ success: true });
  });
  assert.deepEqual(await api.exchange('code', 'verifier'), { accessToken: 'access', refreshToken: 'refresh' });
  assert.deepEqual(await api.profile('access'), profile);
  assert.deepEqual(await api.refresh('refresh'), { accessToken: 'new-access', refreshToken: 'new-refresh' });
  await api.logout('new-refresh');
  assert.deepEqual(calls.map(call => call.path), ['/api/auth/oauth/token', '/api/auth/oauth/userinfo', '/api/auth/refresh', '/api/auth/logout']);
  assert.deepEqual(calls.map(call => call.url), ['http://localhost:3002/api/auth/oauth/token', 'http://localhost:3002/api/auth/oauth/userinfo', 'http://localhost:3002/api/auth/refresh', 'http://localhost:3002/api/auth/logout']);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { grant_type: 'authorization_code', client_id: 'test-client', redirect_uri: config.redirectUri, code: 'code', code_verifier: 'verifier' });
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), { refreshToken: 'refresh' });
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).has('Cookie'), false);
    assert.doesNotMatch(String(init.body), /client_secret|grant_type.*refresh_token/);
  }
});
test('malformed token, refresh and logout responses are rejected', async () => {
  for (const body of [null, {}, { access_token: 'x', token_type: 'Bearer' }, { success: true, accessToken: 'x' }]) {
    const api = createAuthApi(config, async () => Response.json(body));
    await assert.rejects(api.exchange('x', 'x'), ContractError);
    await assert.rejects(api.refresh('x'), ContractError);
  }
  await assert.rejects(createAuthApi(config, async () => Response.json({})).logout('x'), ContractError);
});
test('timeouts and HTTP failures do not retry or expose response text', async () => {
  let calls = 0;
  const api = createAuthApi(config, async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
  }, 5);
  await assert.rejects(api.refresh('x'));
  assert.equal(calls, 1);
  const errorApi = createAuthApi(config, async () => new Response('sensitive upstream data', { status: 401 }));
  await assert.rejects(errorApi.profile('x'), error => error instanceof ApiError && error.status === 401 && !error.message.includes('sensitive'));
});
test('storage migrates legacy keys, validates records and stores a single credential pair', async () => {
  const values = new Map<string, string>([['oauth_access_token', 'old'], ['oauth_refresh_token', 'old-refresh']]);
  const storage = createSessionStorage({
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async key => { values.delete(key); },
  });
  assert.equal(await storage.load(), null);
  assert.equal(values.size, 0);
  const session = { version: 1 as const, accessToken: 'a', refreshToken: 'r', userId: profile._id };
  await storage.save(session);
  assert.deepEqual(await storage.load(), session);
  assert.equal(values.size, 1);
  values.set(SESSION_KEY, '{broken');
  assert.equal(await storage.load(), null);
  await storage.clear();
  assert.equal(values.size, 0);
});

test('secure storage cleanup attempts every key even when deletion fails', async () => {
  const removed: string[] = [];
  const storage = createSessionStorage({
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async key => { removed.push(key); if (key === SESSION_KEY) throw new Error('storage'); },
  });
  await assert.rejects(storage.clear());
  assert.deepEqual(removed.sort(), ['oauth_access_token', 'oauth_refresh_token', SESSION_KEY].sort());
});
