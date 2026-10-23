# Mobile example architecture

[Setup and commands](README.md) | [Agent guidance](AGENTS.md) | [Current verification](README.md#current-verification-status)

This describes the working-tree implementation inspected on 2026-10-23. Source inspection is evidence of implementation, not proof of installed-device behavior or live interoperability.

## Runtime composition

Mobile A is an Expo 57 / React Native application entered through `expo-router/entry`. Rita ID owns authentication; the sibling Web Example is application backend B. A opens the Rita Portal for authorization, exchanges the code with Rita ID, then hands the OAuth credentials to B. B returns an opaque application credential X and owns subsequent OAuth refresh and revocation.

| Location | Responsibility |
| --- | --- |
| [app.json](app.json) | Native scheme, Android identifier, plugins and Expo Router configuration. |
| [root layout](src/app/_layout.tsx) | Mounts AuthProvider and navigation theme; displays loading/cancel UI, Login or authenticated tabs. |
| [auth context](src/context/auth-context.tsx) | Creates one session per provider instance, subscribes to state and verifies at mount and on return to foreground. Exposes actions through useAuth. |
| [config](src/constants/config.ts) | Reads statically referenced public environment values and validates origins/client/callback. |
| [native runtime](src/services/auth-runtime.ts) | Injects Expo Crypto, SecureStore, WebBrowser, HTTP adapters and configuration into AuthSession. |
| [web runtime](src/services/auth-runtime.web.ts) | Throws a native-only sign-in error; AuthProvider also explicitly rejects web authentication. |
| [OAuth flow](src/services/oauth-flow.ts) | Authorization URL, PKCE helpers and one-use callback validation. |
| [Rita adapter](src/services/auth-service.ts) | Code exchange, JSON transport, runtime validators and profile mapping. |
| [B adapter](src/services/backend-service.ts) | Handoff, me, logout and restricted private-resource requests. |
| [session coordinator](src/services/auth-session.ts) | In-memory state, login/handoff, verification, cancellation, serialized storage operations and logout. |
| [session storage](src/services/session-storage.ts) | Validates and stores the versioned X record; removes legacy credentials. |

Home (`src/app/index.tsx`) renders the verified profile, theme-aware account details and sign-out. Explore remains template content. Login supplies sign-in, verification/handoff retry and cleanup actions. Native tabs use Home colors; separate `.web.tsx` components support preview rendering without enabling web sign-in. Home uses initials rather than the profile avatar URL, and does not display position data.

`src/app/redirect.tsx` only redirects to `/`. It does not exchange an authorization code. The active login attempt consumes the URL returned by `WebBrowser.openAuthSessionAsync`; the scheme in `app.json` must be installed on the device. A process restart loses pending login/handoff state.

## Authorization and HTTP boundaries

1. Login clears stored credentials and generates independent cryptographic state and verifier values using 32 random bytes each. PKCE uses SHA-256 and base64url encoding.
2. The system browser opens the portal's `/oauth/authorize` with public client ID, exact callback, `response_type=code`, `openid profile email`, state and S256 challenge.
3. The attempt expires after 10 minutes. Callback consumption is single-use, even on validation failure. It checks scheme/host/path, rejects credentials/fragments/duplicate query keys, checks state and rejects OAuth errors or missing code. This is an acceptance deadline, not a timer that forcibly closes the browser.
4. A exchanges the code with Rita ID without a client secret. It validates the token response, then creates one handoff ID and a fixed 120-second retry deadline.
5. B returns X, expiry and profile. A persists X metadata before publishing authenticated identity, then drops pending OAuth token references.

All HTTP calls use a 10-second AbortController timeout, `credentials: omit`, redirect rejection and JSON responses. Errors are represented as sanitized API, transport or contract errors; upstream error text is not displayed. Origins must be HTTPS outside the development runtime. Environment values are public bundle data; the parser's exact rules and setup are documented in [README](README.md#configuration-and-native-setup).

| Destination and method/path | Request | Accepted result |
| --- | --- | --- |
| Rita API: POST `/api/auth/oauth/token` | Authorization-code JSON with client_id, redirect_uri, code and code_verifier | Bearer access_token and refresh_token, positive finite expires_in. |
| B: POST `/api/mobile/auth/session` | handoffId, clientId, accessToken, refreshToken; no Bearer X | sessionKey, expiresAt, profile. |
| B: GET `/api/mobile/me` | Bearer X | expiresAt, profile. |
| B: POST `/api/mobile/auth/logout` | Bearer X; no body | loggedOut=true and boolean revokeConfirmed. |
| B: private `/api/mobile/` resources | Bearer X; supported method and optional JSON body | Unknown JSON that the caller must validate. B's current `/private/example` supports GET. |

The Rita API path above includes the `/api` prefix added to A's portal origin. The authorization browser URL does not use that prefix. No HTTP cookies are used by these adapters; browser SSO cookies remain owned by the system-browser flow.

The private helper accepts only ASCII letters, digits, slash, underscore and hyphen under `/api/mobile/`, excludes `/api/mobile/auth/` and duplicate slashes, and accepts no arbitrary caller headers. Query strings, encoded paths, dot segments and foreign URLs fail before transport. It never automatically retries or replays business operations, including POST.

`parseProfile` requires a UUID `sub`, strings name/email, boolean is_developer, groups EMPLOYEE/CUSTOMER/ENTERPRISE, nullable string employee_id/phone_number/avatar, and the complete position object. Position text is nullable; all category values are strings and `others` is a string array. Unknown fields are discarded. The mapper exposes `sub` as UI `_id`; employee_id is not that UUID. A does not decode JWTs, call userinfo, refresh OAuth credentials or infer authorization from display fields.

## Session lifecycle and storage

SecureStore key `app_backend_session_v2` contains only `version: 2`, `sessionKey`, `userId`, `expiresAt` and `backendOrigin`. OAuth tokens and the profile are never persisted. Loading validates the record, including UUID, opaque non-whitespace X, HTTP(S) origin and UTC timestamp (seconds or exactly three fractional digits). Invalid records are cleared. Presence of any legacy `rita_session_v1`, `oauth_access_token` or `oauth_refresh_token` record clears all legacy and current keys and requires fresh login.

Startup and foreground verification load/check X before calling B. An expired or different-origin record is discarded without transmitting X. B must return the same UUID and a future expiry; metadata is saved before identity becomes visible. B is authoritative, while A's clock can conservatively expire a session early. X has B's session expiry, not the OAuth access-token expiry.

| State | Entry and UI behavior |
| --- | --- |
| signedOut | No stored session, completed cleanup, terminal login failure or expired handoff; Login shown, possibly with a message. |
| loading | Login, transfer, verification or logout in progress; identity hidden, cancel/sign-out available. |
| authenticated | Valid profile and saved session metadata; Home/Explore tabs shown. |
| unverified | Storage-read or temporary verification failure, including network/5xx or permission denial; identity hidden and verification retry offered. Existing X is retained where available. |
| handoff | Retryable transfer failure or Retry-After wait; explicit retry/cancel offered while credentials remain in RAM. |
| cancelled | Browser returns a non-success result; a new login may be started. |
| error | Cleanup failure blocks a new login until sign-out cleanup succeeds. The context also uses this state for unsupported platform/configuration errors, disabling login. |

Verification 401 clears the session. Invalid/changed profile, expired returned metadata or failed metadata save cause best-effort B logout and local discard. Verification 403 retains X but hides identity. Private-resource errors propagate; only 401 discards the current session, while 403 retains it. No refresh runs in A.

Handoff network/timeout, 429 and 5xx failures allow manual retry with the identical payload. Retry-After supports seconds or an HTTP date; retry cannot extend the 120-second deadline. Other HTTP errors and malformed success responses end the attempt. A timer drops pending references; retry and foreground checks also enforce expiry because the OS may suspend timers. There is no persisted handoff recovery after restart.

Logout blocks further work, invalidates the active generation and removes pending credentials. It asks B to close a known X and clears local storage even if the request fails. Logout 401 counts as already closed; false/unconfirmed revocation produces an explicit warning. Storage deletion attempts every current/legacy key; a failed deletion keeps login blocked until cleanup succeeds. Signing out of A does not remove Rita's browser SSO cookie.

## Concurrency and cleanup

The epoch counter prevents old async results from publishing a profile or clearing a newer session. Login/transfer flags prevent duplicate exchanges and handoffs, verification calls share a promise and repeated logout calls share completion. Storage reads, writes and deletion run through a promise queue so logout cleanup follows an already-running save.

A known X arriving after cancellation/deadline, failing persistence, or accompanying a malformed handoff response is closed at B on a best-effort basis. If no usable X reaches A, A cannot reliably close that server session; B must expire it. Clearing string references does not establish secure memory erasure. A does not revoke Rita tokens after an uncertain handoff because B may already have accepted and rotated them.

## Backend ownership and known limits

The [phase-1 contract](docs/mobile-backend-contract.md) records client fields and target requirements; its statement that B is not implemented is outdated. The sibling [current B guide](../oauth02-web-integration-example/docs/mobile-backend.md) describes implemented mobile routes, replay handling, refresh, revocation and profile startup. B isolates mobile Bearer sessions from browser cookie/CSRF sessions and stores its state in RAM. Restart loses X and replay state; the demo does not support production mode or multiple workers.

B verifies JWT/userinfo identity and rotates the submitted refresh credential to verify consistent subject/client/scopes. Rita's access JWT does not identify the original OAuth session, so this cannot prove the submitted pair belongs to one original grant. The stronger phase-1 pair-binding wording is a requirement, not evidence of an implemented guarantee. No full OIDC or production-readiness claim is made here.

Existing `console.log` calls in the native runtime and handoff catch path print configuration/error objects. They are observed debug behavior, not a convention to extend; this documentation task does not remove them or claim that all logs have been audited. Do not add credentials or real profile data to logging.

The [contract tests](test/contracts.test.ts) cover parsing, callback/transport boundaries and storage; [session tests](test/session.test.ts) cover lifecycle, failure, timeout and concurrency with injected dependencies and fictional fixtures. They cannot prove native SecureStore/browser behavior, B's server guarantees, live Rita compatibility or visual accessibility. Refer to [current verification](README.md#current-verification-status) for executed evidence and [acceptance checks](README.md#phase-2-acceptance-checklist) for remaining integration work.
