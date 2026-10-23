import type { AuthConfig } from '../constants/config';

export class LoginError extends Error {}
export interface PendingLogin { state: string; verifier: string; expiresAt: number; used: boolean }
export function authorizeUrl(config: AuthConfig, state: string, challenge: string): string {
  const url = new URL('/oauth/authorize', config.portalUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: 'code', scope: 'openid profile email', state,
    code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}
export function consumeCallback(value: string, redirectUri: string, pending: PendingLogin, now: number): string {
  if (pending.used || pending.expiresAt <= now) throw new LoginError('Login expired. Please try again.');
  pending.used = true;
  let url: URL;
  try { url = new URL(value); } catch { throw new LoginError('Invalid login callback.'); }
  const expected = new URL(redirectUri);
  if (url.protocol !== expected.protocol || url.host !== expected.host ||
      url.pathname !== expected.pathname || url.username || url.password || url.hash) {
    throw new LoginError('Invalid login callback.');
  }
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) throw new LoginError('Invalid login callback.');
    seen.add(key);
  }
  if (url.searchParams.get('state') !== pending.state) throw new LoginError('Invalid login state.');
  if (url.searchParams.has('error')) throw new LoginError('Sign-in was declined or cancelled.');
  const code = url.searchParams.get('code');
  if (!code?.trim()) throw new LoginError('Missing authorization code.');
  return code;
}
export const base64Url = (value: string) => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
