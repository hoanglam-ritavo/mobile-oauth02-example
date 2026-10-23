import type { AuthConfig } from '../constants/config';
import { ApiError, ContractError, type AuthApi, type UserProfile } from './auth-service';
import { authorizeUrl, consumeCallback, LoginError } from './oauth-flow';
import type { SessionStorage, StoredSession } from './session-storage';

export interface AuthState {
  status: 'signedOut' | 'loading' | 'authenticated' | 'unverified' | 'cancelled' | 'error';
  user: UserProfile | null;
  error: string | null;
}
export interface AuthDependencies {
  config: AuthConfig;
  api: AuthApi;
  storage: SessionStorage;
  random: () => string;
  challenge: (verifier: string) => Promise<string>;
  browser: (url: string, redirect: string) => Promise<{ type: string; url?: string }>;
  now?: () => number;
}
class Superseded extends Error {}

export class AuthSession {
  state: AuthState = { status: 'signedOut', user: null, error: null };
  private listeners = new Set<(state: AuthState) => void>();
  private session: StoredSession | null = null;
  private loaded = false;
  private epoch = 0;
  private blocked = false;
  private loginPending = false;
  private verification?: Promise<void>;
  private rotation?: Promise<void>;
  private signingOut?: Promise<void>;
  private latestRefresh?: string;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: AuthDependencies) {}

  subscribe(listener: (state: AuthState) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(status: AuthState['status'], user: UserProfile | null = null, error: string | null = null) {
    this.state = { status, user, error };
    this.listeners.forEach(listener => listener(this.state));
  }
  private current(epoch: number) {
    if (this.blocked || epoch !== this.epoch) throw new Superseded();
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action);
    this.writes = result.catch(() => undefined);
    return result;
  }
  private async discard(message: string) {
    const epoch = ++this.epoch;
    this.blocked = true;
    this.session = null;
    this.latestRefresh = undefined;
    this.loaded = true;
    try {
      await this.enqueue(() => this.deps.storage.clear());
      if (epoch !== this.epoch) return;
      this.blocked = false;
      this.emit('signedOut', null, message);
    } catch {
      if (epoch !== this.epoch) return;
      this.emit('error', null, 'Unable to clear secure storage. Retry sign-out before signing in.');
      // Do not reload residual credentials in this process.
      this.blocked = true;
    }
  }
  private async commit(value: StoredSession, user: UserProfile, epoch: number) {
    this.current(epoch);
    await this.enqueue(async () => {
      this.current(epoch);
      await this.deps.storage.save(value);
    });
    this.current(epoch);
    this.session = value;
    this.latestRefresh = value.refreshToken;
    this.loaded = true;
    this.emit('authenticated', user);
  }

  login = async (): Promise<void> => {
    if (this.blocked || this.loginPending || this.verification || this.rotation) return;
    this.loginPending = true;
    const epoch = ++this.epoch;
    this.emit('loading');
    try {
      // A new account must never inherit an older account's credentials.
      await this.enqueue(() => this.deps.storage.clear());
      this.current(epoch);
      this.session = null;
      this.latestRefresh = undefined;
      this.loaded = true;
      const pending = {
        state: this.deps.random(), verifier: this.deps.random(),
        expiresAt: (this.deps.now ?? Date.now)() + 600_000, used: false,
      };
      const challenge = await this.deps.challenge(pending.verifier);
      this.current(epoch);
      const result = await this.deps.browser(
        authorizeUrl(this.deps.config, pending.state, challenge), this.deps.config.redirectUri,
      );
      this.current(epoch);
      if (result.type !== 'success') {
        this.emit('cancelled', null, 'Sign-in was cancelled.');
        return;
      }
      const code = consumeCallback(result.url ?? '', this.deps.config.redirectUri, pending, (this.deps.now ?? Date.now)());
      const tokens = await this.deps.api.exchange(code, pending.verifier);
      this.current(epoch);
      const user = await this.deps.api.profile(tokens.accessToken);
      await this.commit({ version: 1, ...tokens, userId: user._id }, user, epoch);
    } catch (error) {
      if (error instanceof Superseded || epoch !== this.epoch) return;
      await this.discard(error instanceof LoginError ? error.message : 'Unable to sign in. Please try again.');
    } finally { this.loginPending = false; }
  };

  private refresh(epoch: number): Promise<void> {
    if (this.rotation) return this.rotation;
    const old = this.session;
    if (!old) return Promise.reject(new ApiError(401));
    this.rotation = (async () => {
      try {
        this.current(epoch);
        const tokens = await this.deps.api.refresh(old.refreshToken);
        // Logout needs the newest known credential even if it superseded this request.
        this.latestRefresh = tokens.refreshToken;
        this.current(epoch);
        const user = await this.deps.api.profile(tokens.accessToken);
        if (user._id !== old.userId) throw new ContractError();
        await this.commit({ version: 1, ...tokens, userId: old.userId }, user, epoch);
      } catch (error) {
        if (!(error instanceof Superseded) && epoch === this.epoch) {
          await this.discard('Session ended. Please sign in again.');
        }
        throw error;
      }
    })().finally(() => { this.rotation = undefined; });
    return this.rotation;
  }

  // Consumers use this for protected API calls; the operation is retried only after a 401.
  async authorized<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    this.current(epoch);
    if (this.loginPending) throw new Superseded();
    if (!this.session) throw new ApiError(401);
    const originalSession = this.session;
    const originalToken = originalSession.accessToken;
    try {
      try {
        const result = await operation(originalToken);
        this.current(epoch);
        return result;
      } catch (error) {
        this.current(epoch);
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      // Another request may already have replaced the failed token.
      if (this.session === originalSession) await this.refresh(epoch);
      this.current(epoch);
      if (!this.session) throw new ApiError(401);
      const result = await operation(this.session.accessToken);
      this.current(epoch);
      return result;
    } catch (error) {
      if (epoch === this.epoch && !(error instanceof Superseded)) {
        if ((error instanceof ApiError && error.status === 401) || error instanceof ContractError) {
          await this.discard('Session ended. Please sign in again.');
        } else {
          this.emit('unverified', null, 'Unable to verify your session. Check your connection and retry.');
        }
      }
      throw error;
    }
  }

  verify = (): Promise<void> => {
    if (this.blocked || this.loginPending) return Promise.resolve();
    if (this.verification) return this.verification;
    const epoch = this.epoch;
    this.emit('loading');
    this.verification = (async () => {
      try {
        if (!this.loaded) {
          const stored = await this.enqueue(() => this.deps.storage.load());
          this.current(epoch);
          this.session = stored;
          this.latestRefresh = stored?.refreshToken;
          this.loaded = true;
        }
        if (!this.session) { this.emit('signedOut'); return; }
        const userId = this.session.userId;
        const user = await this.authorized(token => this.deps.api.profile(token));
        this.current(epoch);
        if (user._id !== userId) throw new ContractError();
        this.emit('authenticated', user);
      } catch (error) {
        if (epoch !== this.epoch || error instanceof Superseded) return;
        if (error instanceof ContractError) {
          await this.discard('Session ended. Please sign in again.');
        } else {
          this.emit('unverified', null, 'Unable to verify your session. Check your connection and retry.');
        }
      }
    })().finally(() => { this.verification = undefined; });
    return this.verification;
  };

  logout = (): Promise<void> => {
    if (this.signingOut) return this.signingOut;
    this.blocked = true;
    ++this.epoch;
    this.emit('loading');
    this.signingOut = (async () => {
      let remoteFailed = false;
      try {
        await this.rotation?.catch(() => undefined);
        if (this.latestRefresh) await this.deps.api.logout(this.latestRefresh);
      } catch { remoteFailed = true; }
      this.session = null;
      this.latestRefresh = undefined;
      this.loaded = true;
      try {
        await this.enqueue(() => this.deps.storage.clear());
        this.blocked = false;
        this.emit('signedOut', null, remoteFailed ? 'Signed out on this device. Rita ID session revocation could not be confirmed.' : null);
      } catch {
        this.emit('error', null, 'Unable to clear secure storage. Retry sign-out before signing in.');
      }
    })().finally(() => { this.signingOut = undefined; });
    return this.signingOut;
  };
}
