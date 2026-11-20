import { isExpiry, isRecord, isToken, isUuid } from "./auth-service";
import { isVerifier } from "./oauth-flow";

export interface StoredSession {
  version: 3;
  refreshToken: string;
  userId: string;
  refreshExpiresAt: string;
  backendOrigin: string;
}
export interface StoredAttempt {
  version: 1;
  attemptId: string;
  state: string;
  verifier: string;
  expiresAt: string;
  backendOrigin: string;
}
export interface KeyStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const SESSION_KEY = "app_backend_session_v3";
export const ATTEMPT_KEY = "rita_login_attempt_v1";
const LEGACY_KEYS = ["app_backend_session_v2", "rita_session_v1", "oauth_access_token", "oauth_refresh_token"];

function isOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || url.protocol === "http:");
  } catch {
    return false;
  }
}

export function createSessionStorage(storage: KeyStorage) {
  async function remove(keys: string[]) {
    const results = await Promise.allSettled(keys.map(key => storage.deleteItemAsync(key)));
    if (results.some(result => result.status === "rejected")) throw new Error("Unable to clear secure storage.");
  }
  async function load<T>(key: string, parse: (data: unknown) => T | null): Promise<T | null> {
    const raw = await storage.getItemAsync(key);
    if (raw === null) return null;
    let result: T | null = null;
    try {
      result = parse(JSON.parse(raw));
    } catch {
      // Remove an unreadable record before allowing a new session.
    }
    if (result === null) await storage.deleteItemAsync(key);
    return result;
  }

  return {
    async migrate() {
      const values = await Promise.all(LEGACY_KEYS.map(key => storage.getItemAsync(key)));
      await remove(LEGACY_KEYS.filter((_key, index) => values[index] !== null));
    },
    loadSession: () => load<StoredSession>(SESSION_KEY, data => {
      if (!isRecord(data) || data.version !== 3 || !isToken(data.refreshToken) ||
          !isUuid(data.userId) || !isExpiry(data.refreshExpiresAt) || !isOrigin(data.backendOrigin)) return null;
      const { refreshToken, userId, refreshExpiresAt, backendOrigin } = data;
      return { version: 3, refreshToken, userId, refreshExpiresAt, backendOrigin };
    }),
    saveSession({ refreshToken, userId, refreshExpiresAt, backendOrigin }: StoredSession) {
      return storage.setItemAsync(SESSION_KEY, JSON.stringify({ version: 3, refreshToken, userId, refreshExpiresAt, backendOrigin }));
    },
    loadAttempt: () => load<StoredAttempt>(ATTEMPT_KEY, data => {
      if (!isRecord(data) || data.version !== 1 || !isUuid(data.attemptId) || !isToken(data.state) ||
          !isVerifier(data.verifier) || !isExpiry(data.expiresAt) || !isOrigin(data.backendOrigin)) return null;
      const { attemptId, state, verifier, expiresAt, backendOrigin } = data;
      return { version: 1, attemptId, state, verifier, expiresAt, backendOrigin };
    }),
    saveAttempt({ attemptId, state, verifier, expiresAt, backendOrigin }: StoredAttempt) {
      return storage.setItemAsync(ATTEMPT_KEY, JSON.stringify({ version: 1, attemptId, state, verifier, expiresAt, backendOrigin }));
    },
    clearAttempt: () => storage.deleteItemAsync(ATTEMPT_KEY),
    clear: () => remove([SESSION_KEY, ATTEMPT_KEY, ...LEGACY_KEYS]),
  };
}
export type SessionStorage = ReturnType<typeof createSessionStorage>;
