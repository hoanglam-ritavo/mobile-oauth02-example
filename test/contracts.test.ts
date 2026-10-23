import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readAuthConfig } from '../src/constants/config';
import { ApiError, ContractError, TransportError, createAuthApi, isExpiry, parseProfile } from '../src/services/auth-service';
import { createBackendApi } from '../src/services/backend-service';
import { authorizeUrl, base64Url, consumeCallback, randomHex } from '../src/services/oauth-flow';
import { createSessionStorage, SESSION_KEY } from '../src/services/session-storage';
import { config, expiry, user, wireProfile } from './fixtures';
const env = { EXPO_PUBLIC_RITA_BASE_URL: config.portalUrl, EXPO_PUBLIC_APP_BACKEND_BASE_URL: config.backendOrigin,
  EXPO_PUBLIC_OAUTH_CLIENT_ID: config.clientId };

test('explicit origins, release HTTPS, exact callback, no legacy fallback', () => {
  assert.equal(config.apiUrl, config.portalUrl + '/api');
  for (const key of Object.keys(env)) assert.throws(() => readAuthConfig({ ...env, [key]: '' }));
  for (const key of ['EXPO_PUBLIC_RITA_BASE_URL', 'EXPO_PUBLIC_APP_BACKEND_BASE_URL']) {
    for (const value of ['ftp://host', 'https://user:pass@host', 'https://host/path', 'https://host?q=x',
      'http://<HOST>:4000', 'https://host/api', 'https://host#fragment', 'https://host?', ' https://host', 'https://host ']) {
      assert.throws(() => readAuthConfig({ ...env, [key]: value }));
    }
    assert.throws(() => readAuthConfig({ ...env, [key]: 'http://localhost:3003' }));
    assert.doesNotThrow(() => readAuthConfig({ ...env, [key]: 'http://localhost:3003' }, true));
  }
  assert.throws(() => readAuthConfig({ ...env, EXPO_PUBLIC_OAUTH_REDIRECT_URI: 'ritaidapp://redirect' }));
});
test('PKCE encoding and authorize contract', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(base64Url(createHash('sha256').update(verifier).digest('base64')), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(randomHex(new Uint8Array(32)).length, 64);
  const url = new URL(authorizeUrl(config, 'state', 'challenge'));
  assert.equal(url.origin, config.portalUrl);
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'rita-id-app://redirect');
  assert.equal(url.searchParams.has('client_secret'), false);
});
test('callback is exact, unique, unexpired and single-use', () => {
  const pending = () => ({ state: 'state', verifier: 'verifier', expiresAt: 100, used: false });
  const attempt = pending();
  assert.equal(consumeCallback('rita-id-app://redirect?state=state&code=code', config.redirectUri, attempt, 0), 'code');
  assert.throws(() => consumeCallback('rita-id-app://redirect?state=state&code=code', config.redirectUri, attempt, 0));
  for (const url of ['ritaidapp://redirect?state=state&code=code', 'other://redirect?state=state&code=code',
    'rita-id-app://wrong?state=state&code=code', 'rita-id-app://redirect/path?state=state&code=code',
    'rita-id-app://redirect?state=wrong&error=denied', 'rita-id-app://redirect?state=state&error=denied',
    'rita-id-app://redirect?state=state', 'rita-id-app://redirect?state=state&state=state&code=code',
    'rita-id-app://redirect?state=state&code=a&code=b', 'rita-id-app://redirect?state=state&code=x#fragment']) {
    assert.throws(() => consumeCallback(url, config.redirectUri, pending(), 0));
  }
  assert.throws(() => consumeCallback('rita-id-app://redirect?state=state&code=x', config.redirectUri, pending(), 100));
});
test('B profile maps sub to local UUID, validates nested fields and strips unknown data', () => {
  assert.deepEqual(parseProfile({ ...wireProfile, ignored: 'secret' }), user);
  for (const key of Object.keys(wireProfile)) assert.throws(() => parseProfile({ ...wireProfile, [key]: undefined }), ContractError);
  for (const groups of ['EMPLOYEE', 'CUSTOMER', 'ENTERPRISE']) assert.equal(parseProfile({ ...wireProfile, groups }).groups, groups);
  for (const patch of [{ sub: 'bad' }, { groups: 'DEVELOPER' }, { avatar: 4 },
    { position: { text: null, parser: {} } },
    { position: { ...wireProfile.position, parser: { ...wireProfile.position.parser, others: [1] } } }]) {
    assert.throws(() => parseProfile({ ...wireProfile, ...patch }), ContractError);
  }
  assert.ok(isExpiry(expiry)); assert.ok(isExpiry('2030-01-01T00:00:00Z'));
  for (const value of ['2030-02-30T00:00:00Z', '2030-01-01', '2030-01-01T00:00:00+00:00']) assert.equal(isExpiry(value), false);
});
test('separate transports: code to Rita, token pair only to handoff, X only to B resources', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const request: typeof fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/token')) return Response.json({ access_token: 'oauth-access', refresh_token: 'oauth-refresh', token_type: 'Bearer', expires_in: 300 });
    if (String(url).endsWith('/logout')) return Response.json({ loggedOut: true, revokeConfirmed: true });
    return Response.json({ sessionKey: 'opaque-X', expiresAt: expiry, profile: wireProfile });
  };
  const rita = createAuthApi(config, request); const backend = createBackendApi(config, request);
  const tokens = await rita.exchange('code', 'verifier');
  await backend.handoff({ ...tokens, handoffId: 'h', clientId: config.clientId });
  await backend.me('opaque-X');
  await backend.privateRequest('opaque-X', '/api/mobile/private/example', { method: 'POST', body: { value: 1 } });
  await backend.logout('opaque-X');
  assert.deepEqual(calls.map(c => c.url), [config.apiUrl + '/auth/oauth/token',
    ...['/api/mobile/auth/session', '/api/mobile/me', '/api/mobile/private/example', '/api/mobile/auth/logout'].map(p => config.backendOrigin + p)]);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { grant_type: 'authorization_code',
    client_id: config.clientId, redirect_uri: config.redirectUri, code: 'code', code_verifier: 'verifier' });
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).has('Cookie'), false);
    assert.doesNotMatch(String(init.body), /client_secret/);
  }
  for (const { init } of calls.slice(2)) {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer opaque-X');
    assert.doesNotMatch(String(init.body), /oauth-access|oauth-refresh/);
  }
  assert.equal(calls[4].init.body, undefined);
});
test('private requests reject foreign, encoded, normalized and auth paths before sending', async () => {
  let count = 0;
  const backend = createBackendApi(config, async () => { count++; return Response.json({}); });
  for (const path of ['https://evil.test', '//evil.test', '/api/mobile/../auth', '/api/mobile/%2e%2e/auth',
    '/api/mobile/\\evil', '/api/mobile//evil', '/api/mobile/auth/session', '/api/mobile/me?token=x', '/auth/oauth/userinfo']) {
    await assert.rejects(backend.privateRequest('X', path), ContractError);
  }
  assert.equal(count, 0);
});
test('malformed responses rejected; malformed handoff with known X is closed', async () => {
  for (const body of [null, {}, { access_token: 'x', token_type: 'Bearer' }]) {
    await assert.rejects(createAuthApi(config, async () => Response.json(body)).exchange('x', 'x'), ContractError);
    await assert.rejects(createBackendApi(config, async () => Response.json(body)).me('X'), ContractError);
  }
  const paths: string[] = [];
  const api = createBackendApi(config, async url => {
    paths.push(String(url)); return Response.json({ sessionKey: 'X', expiresAt: expiry, profile: {} });
  });
  await assert.rejects(api.handoff({ handoffId: 'h', clientId: 'c', accessToken: 'a', refreshToken: 'r' }), ContractError);
  assert.ok(paths[1].endsWith('/auth/logout'));
  await assert.rejects(api.logout('X'), ContractError);
});
test('timeout does not retry and errors do not expose upstream response', async () => {
  let calls = 0;
  const api = createBackendApi(config, async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('secret'))));
  }, 5);
  await assert.rejects(api.me('X'), TransportError); assert.equal(calls, 1);
  await assert.rejects(createBackendApi(config, async () => new Response('secret', { status: 401 })).me('X'),
    error => error instanceof ApiError && error.status === 401 && !error.message.includes('secret'));
  await assert.rejects(createBackendApi(config, async () => new Response('', { status: 429, headers: { 'Retry-After': '30' } })).me('X'),
    error => error instanceof ApiError && error.retryAt > Date.now() + 28_000);
});
test('storage removes every legacy version and persists only the allowlisted X record', async () => {
  const values = new Map<string, string>();
  const storage = createSessionStorage({ getItemAsync: async k => values.get(k) ?? null,
    setItemAsync: async (k, v) => { values.set(k, v); }, deleteItemAsync: async k => { values.delete(k); } });
  for (const legacy of ['rita_session_v1', 'oauth_access_token', 'oauth_refresh_token']) {
    values.set(legacy, 'secret'); assert.equal(await storage.load(), null); assert.equal(values.size, 0);
  }
  const session = { version: 2 as const, sessionKey: 'X', userId: user._id, expiresAt: expiry, backendOrigin: config.backendOrigin };
  await storage.save({ ...session, accessToken: 'must-not-persist' } as typeof session);
  assert.deepEqual(await storage.load(), session);
  assert.doesNotMatch(values.get(SESSION_KEY)!, /accessToken|must-not/);
  for (const raw of ['{broken', JSON.stringify({ ...session, expiresAt: 'bad' }), JSON.stringify({ ...session, version: 1 })]) {
    values.set(SESSION_KEY, raw); assert.equal(await storage.load(), null);
  }
});
test('cleanup attempts all keys despite a deletion failure', async () => {
  const removed: string[] = [];
  const storage = createSessionStorage({ getItemAsync: async () => null, setItemAsync: async () => {},
    deleteItemAsync: async key => { removed.push(key); if (key === SESSION_KEY) throw new Error('failed'); } });
  await assert.rejects(storage.clear());
  assert.deepEqual(removed.sort(), ['rita_session_v1', 'oauth_access_token', 'oauth_refresh_token', SESSION_KEY].sort());
});

test('body transport failure is sanitized and distinct from malformed JSON', async () => {
  const response = Response.json({});
  response.json = async () => { throw new TypeError('sensitive transport details'); };
  await assert.rejects(createBackendApi(config, async () => response).me('X'), TransportError);
  await assert.rejects(createBackendApi(config, async () => new Response('{broken')).me('X'), ContractError);
});
