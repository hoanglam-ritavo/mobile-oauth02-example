import { isExpiry, isRecord, isToken, isUuid } from './auth-service';

export interface StoredSession {
  version: 2; sessionKey: string; userId: string; expiresAt: string; backendOrigin: string;
}
export interface KeyStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
export const SESSION_KEY = 'app_backend_session_v2';
const LEGACY_KEYS = ['rita_session_v1', 'oauth_access_token', 'oauth_refresh_token'];
export function createSessionStorage(storage: KeyStorage) {
  const clear = async () => {
    const results = await Promise.allSettled([...LEGACY_KEYS, SESSION_KEY].map(key => storage.deleteItemAsync(key)));
    if (results.some(result => result.status === 'rejected')) throw new Error('Unable to clear secure storage.');
  };
  return {
    async load(): Promise<StoredSession | null> {
      if ((await Promise.all(LEGACY_KEYS.map(key => storage.getItemAsync(key)))).some(value => value !== null)) {
        await clear(); return null;
      }
      const raw = await storage.getItemAsync(SESSION_KEY);
      if (raw === null) return null;
      try {
        const data: unknown = JSON.parse(raw);
        if (isRecord(data) && data.version === 2 && isUuid(data.userId) && isToken(data.sessionKey) &&
            isExpiry(data.expiresAt) && typeof data.backendOrigin === 'string' &&
            new URL(data.backendOrigin).origin === data.backendOrigin &&
            ['http:', 'https:'].includes(new URL(data.backendOrigin).protocol)) {
          return { version: 2, sessionKey: data.sessionKey, userId: data.userId,
            expiresAt: data.expiresAt, backendOrigin: data.backendOrigin };
        }
      } catch { /* Invalid data cannot restore a session. */ }
      await clear(); return null;
    },
    save(value: StoredSession) {
      const { sessionKey, userId, expiresAt, backendOrigin } = value;
      return storage.setItemAsync(SESSION_KEY, JSON.stringify({ version: 2, sessionKey, userId, expiresAt, backendOrigin }));
    },
    clear,
  };
}
export type SessionStorage = ReturnType<typeof createSessionStorage>;
