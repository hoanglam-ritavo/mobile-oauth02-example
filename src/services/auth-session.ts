import type { AuthConfig } from "../constants/config";
import { ApiError, ContractError, TransportError } from "./auth-service";
import type {
  BackendApi,
  LoginCompletion,
  PrivateRequest,
  SessionGrant,
  UserProfile,
} from "./backend-service";
import { authorizeUrl, readCallback } from "./oauth-flow";
import type {
  SessionStorage,
  StoredAttempt,
  StoredSession,
} from "./session-storage";

export interface AuthState {
  status:
    | "signedOut"
    | "loading"
    | "authenticated"
    | "waiting"
    | "handoff"
    | "unverified"
    | "cancelled"
    | "error";
  user: UserProfile | null;
  error: string | null;
}
export interface AuthDependencies {
  config: AuthConfig;
  backend: BackendApi;
  storage: SessionStorage;
  verifier: () => string;
  challenge: (verifier: string) => Promise<string>;
  links: {
    open: (url: string) => Promise<unknown>;
    initial: () => Promise<string | null>;
    subscribe: (receive: (url: string) => void) => () => void;
  };
  now?: () => number;
}
type Access = { token: string; expiresAt: number };
type Completion = {
  payload: LoginCompletion;
  deadline: number;
  retryAt: number;
};

class Superseded extends Error {}
class StorageFailure extends Error {}
const expiredLogin = "Yêu cầu đăng nhập đã hết hạn. Vui lòng bắt đầu lại.";
const expiredSession = "Phiên đã kết thúc. Vui lòng đăng nhập lại.";
const cleanupFailed =
  "Chưa thể xóa dữ liệu đăng nhập trên thiết bị. Vui lòng thử lại.";

export class AuthSession {
  state: AuthState = { status: "loading", user: null, error: null };
  private readonly listeners = new Set<(state: AuthState) => void>();
  private readonly now: () => number;
  private epoch = 0;
  private initialized = false;
  private initializing?: Promise<void>;
  private starting = false;
  private transferring = false;
  private waiting?: StoredAttempt;
  private completion?: Completion;
  private stored?: StoredSession;
  private access?: Access;
  private refreshInFlight?: Promise<Access>;
  private verification?: Promise<void>;
  private resetting?: Promise<void>;
  private storageQueue = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly deps: AuthDependencies) {
    this.now = deps.now ?? Date.now;
  }

  subscribe(listener: (state: AuthState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connectLinks(): () => void {
    let connected = true;
    const receive = (url: string) => {
      if (connected) void this.receiveCallback(url);
    };
    const unsubscribe = this.deps.links.subscribe(receive);
    void this.deps.links
      .initial()
      .then((url) => {
        if (url) receive(url);
      })
      .catch(() => {});
    return () => {
      connected = false;
      unsubscribe();
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
    if (epoch !== this.epoch) throw new Superseded();
  }

  private queue<T>(operation: () => Promise<T>) {
    const pending = this.storageQueue.then(operation);
    this.storageQueue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }

  private async write(epoch: number, operation: () => Promise<void>) {
    await this.queue(async () => {
      this.current(epoch);
      try {
        await operation();
      } catch {
        throw new StorageFailure();
      }
      this.current(epoch);
    });
    this.current(epoch);
  }

  private stopTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private watchDeadline(deadline: number) {
    this.stopTimer();
    this.timer = setTimeout(
      () => {
        void this.expireLogin();
      },
      Math.max(0, deadline - this.now()),
    );
  }

  private async expireLogin(): Promise<boolean> {
    const deadline =
      this.completion?.deadline ??
      (this.waiting ? Date.parse(this.waiting.expiresAt) : Infinity);
    if (this.now() < deadline) return false;
    await this.reset(expiredLogin);
    return true;
  }

  private initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initializing) return this.initializing;
    const epoch = this.epoch;
    const job = this.restore(epoch).finally(() => {
      if (this.initializing === job) this.initializing = undefined;
    });
    this.initializing = job;
    return job;
  }

  private async restore(epoch: number) {
    try {
      await this.queue(async () => {
        this.current(epoch);
        await this.deps.storage.migrate();
        let stored = await this.deps.storage.loadSession();
        let attempt = await this.deps.storage.loadAttempt();
        this.current(epoch);
        if (
          stored &&
          (stored.backendOrigin !== this.deps.config.backendOrigin ||
            Date.parse(stored.refreshExpiresAt) <= this.now())
        ) {
          await this.deps.storage.clear();
          stored = null;
          attempt = null;
        } else if (
          attempt &&
          (stored ||
            attempt.backendOrigin !== this.deps.config.backendOrigin ||
            Date.parse(attempt.expiresAt) <= this.now())
        ) {
          await this.deps.storage.clearAttempt();
          attempt = null;
        }
        this.current(epoch);
        this.stored = stored ?? undefined;
        this.waiting = attempt ?? undefined;
        this.initialized = true;
        if (attempt) {
          this.watchDeadline(Date.parse(attempt.expiresAt));
          this.emit("waiting");
        } else if (!stored) {
          this.emit("signedOut");
        }
      });
    } catch (error) {
      if (epoch === this.epoch && !(error instanceof Superseded))
        this.emit("error", null, cleanupFailed);
    }
  }

  login = async () => {
    await this.initialize();
    if (
      !this.initialized ||
      this.resetting ||
      this.starting ||
      this.stored ||
      this.waiting ||
      this.completion ||
      this.state.status === "error" ||
      this.state.status === "loading"
    )
      return;
    const epoch = ++this.epoch;
    this.starting = true;
    this.emit("loading");
    let attempt: StoredAttempt | undefined;
    try {
      const verifier = this.deps.verifier();
      const challenge = await this.deps.challenge(verifier);
      this.current(epoch);
      const result = await this.deps.backend.start(challenge);
      this.current(epoch);
      const now = this.now();
      const deadline = Math.min(
        Date.parse(result.expiresAt),
        now + 10 * 60_000,
      );
      if (!(deadline > now)) throw new ContractError();
      const record: StoredAttempt = {
        version: 1,
        attemptId: result.attemptId,
        state: result.state,
        verifier,
        expiresAt: new Date(deadline).toISOString(),
        backendOrigin: this.deps.config.backendOrigin,
      };
      await this.write(epoch, () => this.deps.storage.saveAttempt(record));
      attempt = record;
      this.waiting = record;
      this.watchDeadline(deadline);
      this.emit("waiting");
      await this.deps.links.open(
        authorizeUrl(this.deps.config.authorizeUrl, result, challenge),
      );
    } catch (error) {
      console.log(
        " this.deps.config.backendOrigin : ",
        this.deps.config.backendOrigin,
      );
      console.log("error logs : ", error);

      if (epoch !== this.epoch || (attempt && this.waiting !== attempt)) return;
      if (attempt)
        await this.reset(
          "Không mở được Rita Võ ID. Hãy kiểm tra ứng dụng đã được cài đặt.",
        );
      else if (error instanceof StorageFailure)
        await this.reset("Không thể lưu yêu cầu đăng nhập.");
      else
        this.emit(
          "signedOut",
          null,
          "Không thể bắt đầu đăng nhập. Vui lòng thử lại (001).",
        );
    } finally {
      if (epoch === this.epoch) this.starting = false;
    }
  };

  async receiveCallback(url: string) {
    await this.initialize();
    const attempt = this.waiting;
    if (
      !attempt ||
      this.resetting ||
      (await this.expireLogin()) ||
      this.waiting !== attempt
    )
      return;
    const result = readCallback(url, attempt.state);
    if (!result) return;
    const epoch = this.epoch;
    const receivedAt = this.now();
    this.waiting = undefined;
    this.stopTimer();
    this.emit("loading");
    try {
      await this.write(epoch, this.deps.storage.clearAttempt);
      if (result.kind === "cancelled") {
        this.emit("cancelled", null, "Đăng nhập đã được hủy.");
        return;
      }
      const deadline = Math.min(
        Date.parse(attempt.expiresAt),
        receivedAt + 60_000,
      );
      this.completion = {
        payload: {
          attemptId: attempt.attemptId,
          state: attempt.state,
          code: result.code,
          codeVerifier: attempt.verifier,
        },
        deadline,
        retryAt: 0,
      };
      this.watchDeadline(deadline);
      await this.transfer();
    } catch {
      if (epoch === this.epoch)
        await this.reset("Không thể dọn giao dịch đăng nhập trên thiết bị.");
    }
  }

  private async transfer() {
    const completion = this.completion;
    if (
      !completion ||
      this.transferring ||
      this.resetting ||
      (await this.expireLogin()) ||
      this.completion !== completion ||
      this.transferring
    )
      return;
    if (this.now() < completion.retryAt) {
      this.emit("handoff", null, "Dịch vụ đang bận. Vui lòng thử lại sau.");
      return;
    }
    const epoch = this.epoch;
    this.transferring = true;
    this.emit("loading");
    let issued: SessionGrant | undefined;
    try {
      issued = await this.deps.backend.complete(completion.payload);
      this.current(epoch);
      if (this.now() >= completion.deadline) {
        await this.reset(expiredLogin);
        return;
      }
      await this.commit(issued, epoch, completion.deadline);
      this.completion = undefined;
      this.stopTimer();
      this.emit("authenticated", issued.user);
      issued = undefined;
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (this.now() >= completion.deadline) await this.reset(expiredLogin);
      else if (
        error instanceof TransportError ||
        (error instanceof ApiError && error.code === "CAPACITY_EXCEEDED")
      ) {
        completion.retryAt =
          error instanceof ApiError
            ? Math.min(error.retryAt, completion.deadline)
            : 0;
        this.emit(
          "handoff",
          null,
          "Chưa thể hoàn tất đăng nhập. Bạn có thể thử lại.",
        );
      } else {
        const message =
          error instanceof ApiError && error.code === "RITA_ACCOUNT_INELIGIBLE"
            ? "Tài khoản này chưa đủ điều kiện đăng nhập."
            : "Không thể hoàn tất đăng nhập. Vui lòng bắt đầu lại.";
        await this.reset(message);
      }
    } finally {
      if (epoch === this.epoch) this.transferring = false;
      if (issued) await this.close(issued.refreshToken);
    }
  }

  private async commit(
    grant: SessionGrant,
    epoch: number,
    deadline = Infinity,
  ): Promise<Access> {
    const access = {
      token: grant.accessToken,
      expiresAt: Date.parse(grant.accessExpiresAt),
    };
    const refreshExpiry = Date.parse(grant.refreshExpiresAt);
    if (
      access.expiresAt <= this.now() ||
      refreshExpiry <= this.now() ||
      (this.stored &&
        (this.stored.userId !== grant.user.id ||
          this.stored.refreshExpiresAt !== grant.refreshExpiresAt))
    ) {
      throw new ContractError();
    }
    const stored: StoredSession = {
      version: 3,
      refreshToken: grant.refreshToken,
      refreshExpiresAt: grant.refreshExpiresAt,
      userId: grant.user.id,
      backendOrigin: this.deps.config.backendOrigin,
    };
    await this.write(epoch, () => this.deps.storage.saveSession(stored));
    if (access.expiresAt <= this.now() || deadline <= this.now())
      throw new ContractError();
    this.stored = stored;
    this.access = access;
    return access;
  }

  private async close(refreshToken: string): Promise<boolean> {
    try {
      await this.deps.backend.logout(refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  private reset(message: string | null, refreshToken?: string) {
    if (this.resetting) return this.resetting;
    ++this.epoch;
    this.initialized = true;
    this.starting = false;
    this.transferring = false;
    this.waiting = undefined;
    this.completion = undefined;
    this.stored = undefined;
    this.access = undefined;
    this.refreshInFlight = undefined;
    this.verification = undefined;
    this.stopTimer();
    this.emit("loading");
    const closure = refreshToken
      ? this.close(refreshToken)
      : Promise.resolve(true);
    const job = (async () => {
      try {
        await this.queue(this.deps.storage.clear);
        const closed = await closure;
        this.emit(
          "signedOut",
          null,
          closed
            ? message
            : "Đã đăng xuất trên thiết bị. Chưa xác nhận thu hồi phiên trên máy chủ.",
        );
      } catch {
        this.emit("error", null, cleanupFailed);
      }
    })().finally(() => {
      this.resetting = undefined;
    });
    this.resetting = job;
    return job;
  }

  private async accessFor(epoch: number): Promise<Access> {
    this.current(epoch);
    const stored = this.stored;
    if (!stored) throw new Superseded();
    const expiresAt = Date.parse(stored.refreshExpiresAt);
    if (expiresAt <= this.now()) {
      await this.reset(expiredSession);
      throw new Superseded();
    }
    const access = this.access;
    if (
      access &&
      access.expiresAt > this.now() &&
      (access.expiresAt - this.now() > 30_000 || access.expiresAt === expiresAt)
    )
      return access;
    if (this.refreshInFlight) return this.refreshInFlight;

    const job = this.rotate(stored, epoch).finally(() => {
      if (this.refreshInFlight === job) this.refreshInFlight = undefined;
    });
    this.refreshInFlight = job;
    return job;
  }

  private async rotate(stored: StoredSession, epoch: number): Promise<Access> {
    let grant: SessionGrant | undefined;
    try {
      grant = await this.deps.backend.refresh(stored.refreshToken);
      this.current(epoch);
      return await this.commit(grant, epoch);
    } catch {
      if (epoch === this.epoch) await this.reset(expiredSession);
      if (grant) await this.close(grant.refreshToken);
      throw new Superseded();
    }
  }

  verify = async () => {
    await this.initialize();
    if (this.resetting || (await this.expireLogin()) || !this.stored) return;
    if (this.verification) return this.verification;
    const epoch = this.epoch;
    const job = this.checkProfile(epoch).finally(() => {
      if (this.verification === job) this.verification = undefined;
    });
    this.verification = job;
    return job;
  };

  private async checkProfile(epoch: number) {
    let access: Access | undefined;
    try {
      access = await this.accessFor(epoch);
      this.current(epoch);
      const user = await this.deps.backend.me(access.token);
      this.current(epoch);
      if (this.access !== access) return;
      if (user.id !== this.stored?.userId) {
        await this.reset(expiredSession, this.stored?.refreshToken);
        return;
      }
      this.emit("authenticated", user);
    } catch (error) {
      if (epoch !== this.epoch || !access || this.access !== access) return;
      if (error instanceof ApiError && error.status === 401)
        await this.reset(expiredSession, this.stored?.refreshToken);
      else
        this.emit(
          "unverified",
          null,
          "Không thể xác minh phiên. Vui lòng thử lại.",
        );
    }
  }

  retry = async () => {
    if (this.completion) await this.transfer();
    else await this.verify();
  };

  async authorized(path: string, options?: PrivateRequest): Promise<unknown> {
    if (this.state.status !== "authenticated") throw new Error(expiredSession);
    const epoch = this.epoch;
    const access = await this.accessFor(epoch);
    this.current(epoch);
    try {
      const result = await this.deps.backend.privateRequest(
        access.token,
        path,
        options,
      );
      this.current(epoch);
      return result;
    } catch (error) {
      if (
        epoch === this.epoch &&
        this.access === access &&
        error instanceof ApiError &&
        error.status === 401
      ) {
        await this.reset(expiredSession, this.stored?.refreshToken);
      }
      throw error;
    }
  }

  logout = () => this.reset(null, this.stored?.refreshToken);
}
