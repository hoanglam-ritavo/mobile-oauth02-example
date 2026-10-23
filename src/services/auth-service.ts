import type { AuthConfig } from '../constants/config';

export interface UserProfile {
  _id: string;
  name: string;
  email: string;
  employee_id: string | null;
  phone_number: string | null;
  is_developer: boolean;
  groups: 'EMPLOYEE' | 'CUSTOMER' | 'ENTERPRISE';
}
export interface Tokens { accessToken: string; refreshToken: string }
export class ApiError extends Error {
  constructor(public readonly status: number) { super('Rita ID request failed.'); }
}
export class ContractError extends Error {
  constructor() { super('Invalid Rita ID response.'); }
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isToken = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function parseProfile(data: unknown): UserProfile {
  if (!isRecord(data) || !isUuid(data._id) || typeof data.name !== 'string' ||
      typeof data.email !== 'string' || typeof data.is_developer !== 'boolean' ||
      (data.employee_id !== null && typeof data.employee_id !== 'string') ||
      (data.phone_number !== null && typeof data.phone_number !== 'string') ||
      (data.groups !== 'EMPLOYEE' && data.groups !== 'CUSTOMER' && data.groups !== 'ENTERPRISE')) {
    throw new ContractError();
  }
  return {
    _id: data._id, name: data.name, email: data.email,
    employee_id: data.employee_id, phone_number: data.phone_number,
    is_developer: data.is_developer, groups: data.groups,
  };
}

export function createAuthApi(config: AuthConfig, request: typeof fetch = fetch, timeoutMs = 10_000) {
  async function json(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await request(config.apiUrl + path, {
        ...init, credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...init.headers },
      });
      if (!response.ok) throw new ApiError(response.status);
      try { return await response.json(); } catch { throw new ContractError(); }
    } finally { clearTimeout(timer); }
  }
  const post = (path: string, body: unknown) => json(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return {
    async exchange(code: string, verifier: string): Promise<Tokens> {
      const data = await post('/auth/oauth/token', {
        grant_type: 'authorization_code', client_id: config.clientId,
        redirect_uri: config.redirectUri, code, code_verifier: verifier,
      });
      if (!isRecord(data) || data.token_type !== 'Bearer' || !isToken(data.access_token) ||
          !isToken(data.refresh_token) || typeof data.expires_in !== 'number' ||
          !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new ContractError();
      return { accessToken: data.access_token, refreshToken: data.refresh_token };
    },
    async profile(accessToken: string) {
      return parseProfile(await json('/auth/oauth/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }));
    },
    async refresh(refreshToken: string): Promise<Tokens> {
      const data = await post('/auth/refresh', { refreshToken });
      if (!isRecord(data) || data.success !== true || !isToken(data.accessToken) ||
          !isToken(data.refreshToken)) throw new ContractError();
      return { accessToken: data.accessToken, refreshToken: data.refreshToken };
    },
    async logout(refreshToken: string) {
      const data = await post('/auth/logout', { refreshToken });
      if (!isRecord(data) || data.success !== true) throw new ContractError();
    },
  };
}
export type AuthApi = ReturnType<typeof createAuthApi>;
