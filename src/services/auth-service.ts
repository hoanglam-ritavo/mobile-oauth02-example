export class ApiError extends Error {
  constructor(readonly status: number, readonly retryAt: number, readonly code?: string) {
    super("Authentication service request failed.");
  }
}
export class TransportError extends Error {
  constructor() { super("Unable to connect to the authentication service."); }
}
export class ContractError extends Error {
  constructor() { super("Invalid authentication service response."); }
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function isExpiry(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
}

export function createJsonClient(base: string, request: typeof fetch, timeoutMs: number, now = Date.now) {
  return async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await request(base + path, {
          ...init, credentials: "omit", redirect: "error", signal: controller.signal,
          headers: { Accept: "application/json", ...init.headers },
        });
      } catch {
        throw new TransportError();
      }
      if (!response.ok) {
        const retry = response.headers.get("Retry-After");
        const date = retry && /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry ?? "");
        let code: string | undefined;
        try {
          const body: unknown = await response.json();
          if (isRecord(body) && typeof body.error === "string" && /^[A-Z_]{1,64}$/.test(body.error)) code = body.error;
        } catch {
          if (controller.signal.aborted) throw new TransportError();
        }
        throw new ApiError(response.status, Number.isFinite(date) ? date : 0, code);
      }
      if (response.status === 204) return undefined;
      try {
        return await response.json();
      } catch (error) {
        if (controller.signal.aborted || error instanceof TypeError) throw new TransportError();
        throw new ContractError();
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
