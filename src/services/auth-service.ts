import type { AuthConfig } from '../constants/config';

export const positionCategories = ['group', 'company', 'department', 'board', 'region', 'store',
  'warehouse', 'factory', 'workshop', 'showroom', 'center', 'cafe'] as const;
export interface UserProfile {
  _id: string; name: string; email: string; employee_id: string | null;
  phone_number: string | null; is_developer: boolean;
  groups: 'EMPLOYEE' | 'CUSTOMER' | 'ENTERPRISE';
  avatar: string | null;
  position: { text: string | null; parser: Record<typeof positionCategories[number], string> & { others: string[] } };
}
export interface Tokens { accessToken: string; refreshToken: string }
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly retryAt = 0) { super('Authentication service request failed.'); }
}
export class TransportError extends Error {
  constructor() { super('Unable to connect to the authentication service.'); }
}
export class ContractError extends Error {
  constructor() { super('Invalid authentication service response.'); }
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !/\s/.test(value);
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function isExpiry(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
}
export function parseProfile(data: unknown): UserProfile {
  if (!isRecord(data) || !isUuid(data.sub) || typeof data.name !== 'string' ||
      typeof data.email !== 'string' || typeof data.is_developer !== 'boolean' ||
      (data.employee_id !== null && typeof data.employee_id !== 'string') ||
      (data.phone_number !== null && typeof data.phone_number !== 'string') ||
      (data.groups !== 'EMPLOYEE' && data.groups !== 'CUSTOMER' && data.groups !== 'ENTERPRISE') ||
      (data.avatar !== null && typeof data.avatar !== 'string') || !isRecord(data.position) ||
      (data.position.text !== null && typeof data.position.text !== 'string') || !isRecord(data.position.parser)) throw new ContractError();
  const parser = data.position.parser;
  if (!positionCategories.every(key => typeof parser[key] === 'string') ||
      !Array.isArray(parser.others) || !parser.others.every(value => typeof value === 'string')) throw new ContractError();
  return {
    _id: data.sub, name: data.name, email: data.email, employee_id: data.employee_id,
    phone_number: data.phone_number, is_developer: data.is_developer, groups: data.groups,
    avatar: data.avatar, position: { text: data.position.text, parser: {
      ...Object.fromEntries(positionCategories.map(key => [key, parser[key]])) as Record<typeof positionCategories[number], string>,
      others: [...parser.others],
    } },
  };
}
export function createJsonClient(base: string, request: typeof fetch, timeoutMs: number, now = Date.now) {
  return async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await request(base + path, { ...init, credentials: 'omit', redirect: 'error',
          signal: controller.signal, headers: { Accept: 'application/json', ...init.headers } });
      } catch { throw new TransportError(); }
      if (!response.ok) {
        const retry = response.headers.get('Retry-After');
        const delay = retry && /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry ?? '');
        throw new ApiError(response.status, Number.isFinite(delay) ? delay : 0);
      }
      try { return await response.json(); } catch (error) {
        if (controller.signal.aborted || error instanceof TypeError) throw new TransportError();
        throw new ContractError();
      }
    } finally { clearTimeout(timer); }
  };
}
export function createAuthApi(config: AuthConfig, request: typeof fetch = fetch, timeoutMs = 10_000) {
  const json = createJsonClient(config.apiUrl, request, timeoutMs);
  return {
    async exchange(code: string, verifier: string): Promise<Tokens> {
      const data = await json('/auth/oauth/token', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          grant_type: 'authorization_code', client_id: config.clientId,
          redirect_uri: config.redirectUri, code, code_verifier: verifier,
        }),
      });
      if (!isRecord(data) || data.token_type !== 'Bearer' || !isToken(data.access_token) ||
          !isToken(data.refresh_token) || typeof data.expires_in !== 'number' ||
          !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new ContractError();
      return { accessToken: data.access_token, refreshToken: data.refresh_token };
    },
  };
}
export type AuthApi = ReturnType<typeof createAuthApi>;
