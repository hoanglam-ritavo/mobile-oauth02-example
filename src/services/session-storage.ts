import { isRecord, isToken, isUuid, type Tokens } from './auth-service';

export interface StoredSession extends Tokens { version: 1; userId: string }
export interface KeyStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
export const SESSION_KEY = 'rita_session_v1';
const LEGACY_KEYS = ['oauth_access_token', 'oauth_refresh_token'];

export function createSessionStorage(storage: KeyStorage) {
  return {
    async load(): Promise<StoredSession | null> {
      const legacy = await Promise.all(LEGACY_KEYS.map(key => storage.getItemAsync(key)));
      if (legacy.some(value => value !== null)) {
        await Promise.all([...LEGACY_KEYS, SESSION_KEY].map(key => storage.deleteItemAsync(key)));
        return null;
      }
      const raw = await storage.getItemAsync(SESSION_KEY);
      if (raw === null) return null;
      try {
        const data: unknown = JSON.parse(raw);
        if (isRecord(data) && data.version === 1 && isUuid(data.userId) &&
            isToken(data.accessToken) && isToken(data.refreshToken)) {
          return { version: 1, userId: data.userId, accessToken: data.accessToken, refreshToken: data.refreshToken };
        }
      } catch { /* Invalid stored data is not a session. */ }
      await storage.deleteItemAsync(SESSION_KEY);
      return null;
    },
    save(value: StoredSession) { return storage.setItemAsync(SESSION_KEY, JSON.stringify(value)); },
    async clear() {
      const results = await Promise.allSettled([...LEGACY_KEYS, SESSION_KEY].map(key => storage.deleteItemAsync(key)));
      if (results.some(result => result.status === 'rejected')) throw new Error('Unable to clear secure storage.');
    },
  };
}
export type SessionStorage = ReturnType<typeof createSessionStorage>;
