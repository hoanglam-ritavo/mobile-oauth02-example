import type { AuthConfig } from "../constants/config";
import {
  ApiError,
  ContractError,
  TransportError,
  type AuthApi,
  type UserProfile,
} from "./auth-service";
import type { BackendApi, Handoff, PrivateRequest } from "./backend-service";
import { authorizeUrl, consumeCallback, LoginError } from "./oauth-flow";
import type { SessionStorage, StoredSession } from "./session-storage";

export interface AuthState {
  status:
    | "signedOut"
    | "loading"
    | "authenticated"
    | "unverified"
    | "handoff"
    | "cancelled"
    | "error";
  user: UserProfile | null;
  error: string | null;
}
export interface AuthDependencies {
  config: AuthConfig;
  api: AuthApi;
  backend: BackendApi;
  storage: SessionStorage;
  random: () => string;
  challenge: (verifier: string) => Promise<string>;
  browser: (
    url: string,
    redirect: string,
  ) => Promise<{ type: string; url?: string }>;
  now?: () => number;
}
class Superseded extends Error {}
class StorageWriteError extends Error {}
interface Pending {
  payload: Handoff;
  deadline: number;
  retryAt: number;
}
export class AuthSession {
  state: AuthState = { status: "signedOut", user: null, error: null };
  private listeners = new Set<(state: AuthState) => void>();
  private session: StoredSession | null = null;
  private loaded = false;
  private epoch = 0;
  private blocked = false;
  private loginPending = false;
  private handingOff = false;
  private verification?: Promise<void>;
  private signingOut?: Promise<void>;
  private pending?: Pending;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: AuthDependencies) {}
  private now() {
    return (this.deps.now ?? Date.now)();
  }
  subscribe(listener: (state: AuthState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(
    status: AuthState["status"],
    user: UserProfile | null = null,
    error: string | null = null,
  ) {
    this.state = { status, user, error };
    this.listeners.forEach((listener) => listener(this.state));
  }
  private current(epoch: number) {
    if (this.blocked || epoch !== this.epoch) throw new Superseded();
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action);
    this.writes = result.catch(() => undefined);
    return result;
  }
  private forgetHandoff() {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    if (this.pending) {
      this.pending.payload.accessToken = "";
      this.pending.payload.refreshToken = "";
    }
    this.pending = undefined;
  }
  private expireHandoff() {
    if (!this.pending || this.now() < this.pending.deadline) return;
    this.forgetHandoff();
    ++this.epoch;
    this.emit(
      "signedOut",
      null,
      "Sign-in transfer expired. Please sign in again.",
    );
  }
  private async close(key: string): Promise<boolean> {
    try {
      return await this.deps.backend.logout(key);
    } catch (error) {
      return error instanceof ApiError && error.status === 401;
    }
  }
  private async discard(message: string | null) {
    const epoch = ++this.epoch;
    this.blocked = true;
    this.forgetHandoff();
    this.session = null;
    this.loaded = true;
    try {
      await this.enqueue(() => this.deps.storage.clear());
      if (epoch !== this.epoch) return;
      this.blocked = false;
      this.emit("signedOut", null, message);
    } catch {
      if (epoch === this.epoch)
        this.emit(
          "error",
          null,
          "Unable to clear secure storage. Retry sign-out before signing in.",
        );
    }
  }
  private async commit(value: StoredSession, user: UserProfile, epoch: number) {
    this.current(epoch);
    await this.enqueue(async () => {
      this.current(epoch);
      try {
        await this.deps.storage.save(value);
      } catch {
        throw new StorageWriteError();
      }
    });
    this.current(epoch);
    if (Date.parse(value.expiresAt) <= this.now()) throw new ContractError();
    this.session = value;
    this.loaded = true;
    this.emit("authenticated", user);
  }
  private async transfer(epoch: number) {
    const pending = this.pending;
    if (!pending || this.handingOff) return;
    if (this.now() >= pending.deadline) {
      this.expireHandoff();
      return;
    }
    if (this.now() < pending.retryAt) {
      this.emit(
        "handoff",
        null,
        `Please retry after ${new Date(pending.retryAt).toISOString()}.`,
      );
      return;
    }
    this.handingOff = true;
    this.emit("loading");
    let key: string | undefined;
    try {
      const result = await this.deps.backend.handoff(pending.payload);
      key = result.sessionKey;
      this.current(epoch);
      if (this.now() >= pending.deadline) {
        this.expireHandoff();
        throw new Superseded();
      }
      if (Date.parse(result.expiresAt) <= this.now()) throw new ContractError();
      this.forgetHandoff();
      await this.commit(
        {
          version: 2,
          sessionKey: key,
          userId: result.profile._id,
          expiresAt: result.expiresAt,
          backendOrigin: this.deps.config.backendOrigin,
        },
        result.profile,
        epoch,
      );
      key = undefined;
    } catch (error) {
      console.log("error : ", error);
      if (key) await this.close(key);
      if (epoch !== this.epoch || error instanceof Superseded) return;
      if (this.pending && this.now() >= pending.deadline) {
        this.expireHandoff();
        return;
      }
      if (
        this.pending &&
        (error instanceof TransportError ||
          (error instanceof ApiError &&
            (error.status === 429 || error.status >= 500)))
      ) {
        this.pending.retryAt =
          error instanceof ApiError
            ? Math.min(error.retryAt, this.pending.deadline)
            : 0;
        this.emit(
          "handoff",
          null,
          "Unable to complete sign-in. Retry the connection within two minutes.",
        );
      } else
        await this.discard(
          "Unable to establish an application session. Please sign in again.",
        );
    } finally {
      this.handingOff = false;
    }
  }
  login = async (): Promise<void> => {
    if (
      this.blocked ||
      this.loginPending ||
      this.verification ||
      this.handingOff ||
      this.pending ||
      this.session
    )
      return;
    this.loginPending = true;
    const epoch = ++this.epoch;
    this.emit("loading");
    try {
      await this.enqueue(() => this.deps.storage.clear());
      this.current(epoch);
      this.loaded = true;
      const attempt = {
        state: this.deps.random(),
        verifier: this.deps.random(),
        expiresAt: this.now() + 600_000,
        used: false,
      };
      const challenge = await this.deps.challenge(attempt.verifier);
      this.current(epoch);
      const result = await this.deps.browser(
        authorizeUrl(this.deps.config, attempt.state, challenge),
        this.deps.config.redirectUri,
      );
      this.current(epoch);
      if (result.type !== "success") {
        this.emit("cancelled", null, "Sign-in was cancelled.");
        return;
      }
      const code = consumeCallback(
        result.url ?? "",
        this.deps.config.redirectUri,
        attempt,
        this.now(),
      );
      const tokens = await this.deps.api.exchange(code, attempt.verifier);
      try {
        this.current(epoch);
        this.pending = {
          payload: {
            ...tokens,
            handoffId: this.deps.random(),
            clientId: this.deps.config.clientId,
          },
          deadline: this.now() + 120_000,
          retryAt: 0,
        };
      } finally {
        tokens.accessToken = "";
        tokens.refreshToken = "";
      }
      this.expiryTimer = setTimeout(() => this.expireHandoff(), 120_000);
      await this.transfer(epoch);
    } catch (error) {
      if (epoch !== this.epoch || error instanceof Superseded) return;
      await this.discard(
        error instanceof LoginError
          ? error.message
          : "Unable to sign in. Please try again.",
      );
    } finally {
      this.loginPending = false;
    }
  };
  retry = async (): Promise<void> => {
    if (this.blocked || this.loginPending || this.handingOff) return;
    if (this.pending) await this.transfer(this.epoch);
    else await this.verify();
  };
  private async requireSession() {
    if (!this.session) throw new ApiError(401);
    if (
      this.session.backendOrigin !== this.deps.config.backendOrigin ||
      Date.parse(this.session.expiresAt) <= this.now()
    ) {
      await this.discard("Session ended. Please sign in again.");
      throw new ApiError(401);
    }
    return this.session;
  }
  // Never exposes the credential to UI callbacks or accepts an arbitrary destination.
  async authorized(
    path: string,
    options: PrivateRequest = {},
  ): Promise<unknown> {
    const epoch = this.epoch;
    this.current(epoch);
    const session = await this.requireSession();
    this.current(epoch);
    try {
      const result = await this.deps.backend.privateRequest(
        session.sessionKey,
        path,
        options,
      );
      this.current(epoch);
      return result;
    } catch (error) {
      if (
        epoch === this.epoch &&
        error instanceof ApiError &&
        error.status === 401
      )
        await this.discard("Session ended. Please sign in again.");
      throw error;
    }
  }
  verify = (): Promise<void> => {
    if (this.blocked || this.loginPending || this.handingOff)
      return Promise.resolve();
    if (this.pending) {
      this.expireHandoff();
      return Promise.resolve();
    }
    if (this.verification) return this.verification;
    const epoch = this.epoch;
    this.emit("loading");
    this.verification = (async () => {
      try {
        if (!this.loaded) {
          const stored = await this.enqueue(() => this.deps.storage.load());
          this.current(epoch);
          this.session = stored;
          this.loaded = true;
        }
        if (!this.session) {
          this.emit("signedOut");
          return;
        }
        const session = await this.requireSession();
        this.current(epoch);
        const result = await this.deps.backend.me(session.sessionKey);
        this.current(epoch);
        if (
          result.profile._id !== session.userId ||
          Date.parse(result.expiresAt) <= this.now()
        )
          throw new ContractError();
        await this.commit(
          { ...session, expiresAt: result.expiresAt },
          result.profile,
          epoch,
        );
      } catch (error) {
        if (epoch !== this.epoch || error instanceof Superseded) return;
        if (
          error instanceof ContractError ||
          error instanceof StorageWriteError ||
          (error instanceof ApiError && error.status === 401)
        ) {
          if (this.session && !(error instanceof ApiError))
            await this.close(this.session.sessionKey);
          if (epoch === this.epoch)
            await this.discard("Session ended. Please sign in again.");
        } else
          this.emit(
            "unverified",
            null,
            error instanceof ApiError && error.status === 403
              ? "Access is not permitted."
              : "Unable to verify your session. Check your connection and retry.",
          );
      }
    })().finally(() => {
      this.verification = undefined;
    });
    return this.verification;
  };
  logout = (): Promise<void> => {
    if (this.signingOut) return this.signingOut;
    const key = this.session?.sessionKey;
    this.blocked = true;
    ++this.epoch;
    this.forgetHandoff();
    this.emit("loading");
    this.signingOut = (async () => {
      const confirmed = key ? await this.close(key) : true;
      await this.discard(
        confirmed
          ? null
          : "Signed out on this device. Server revocation could not be confirmed.",
      );
    })().finally(() => {
      this.signingOut = undefined;
    });
    return this.signingOut;
  };
}
