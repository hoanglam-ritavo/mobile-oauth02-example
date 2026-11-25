# Mobile example architecture

[Setup and verification](README.md) · [Agent guidance](AGENTS.md)

D is Rita Partner Demo, an Expo Router app for Android and iOS. D opens B at `rita-id://oauth/authorize` and handles `rita-partner-demo://redirect` with its own native app identifiers. C owns confidential code exchange, user mapping and the D session. A is the Rita Võ ID Backend. See [B's native authorization flow](../rita-id-app/ARCHITECTURE.md#partner-mobile-authorization) and [A's OAuth boundary](../rita-id-backend/ARCHITECTURE.md#partner-mobile-authorization).

## Ownership

| Area | Responsibility |
| --- | --- |
| [Auth context](src/context/auth-context.tsx) | Attaches the native callback listener and foreground verification to the root. UI calls sign-in, retry, sign-out and private requests through `useAuth`. |
| [Root stack](src/app/_layout.tsx) | Keeps the navigator mounted during session restoration, shows Login at `/login` while signed out, and protects Home at `/` until the C session is authenticated. An overlay reports loading and offers cancellation. |
| [AuthSession](src/services/auth-session.ts) | Owns login/refresh state, generation checks, timers, coalescing, and serialized SecureStore operations. |
| [Native runtime](src/services/auth-runtime.ts) | Injects Expo Crypto, Linking and SecureStore. Handles initial URLs and URL events through one coordinator. |
| [OAuth helpers](src/services/oauth-flow.ts) | Builds the configured B app link from the C-issued parameters. Validates the exact callback URI and state. |
| [C adapter](src/services/backend-service.ts) | Starts and completes login, refreshes and logs out, validates application profiles, and authorizes private requests. |
| [Storage](src/services/session-storage.ts) | Owns the separate, versioned allowlists for refresh credentials and pre-callback attempts. |
| [Native intent](src/app/+native-intent.tsx) | Routes the callback to Home without copying OAuth query fields into the navigation state. Native Linking still receives the original URL. |

## Authorization and HTTP boundaries

1. D generates a cryptographic PKCE verifier and posts its S256 challenge to C. D validates C's attempt ID, state, expiry, client ID, scope and exact registered callback.
2. D persists the pending attempt before opening the configured B entry. A matching callback can finish after D is relaunched. The record binds C's origin and the callback URI and is capped at 10 minutes. Older records use the native callback. A record is discarded if the callback configuration changes.
3. D accepts the first callback with the exact URI, matching state and a single code or error. Invalid and duplicate URLs leave the active flow safe. B can return `access_denied` with the original state when the user returns before signing in or declines consent after signing in. D clears the stored attempt and reports cancellation without calling `POST /api/mobile/auth/session`. For a valid code, D clears the same record before sending the completion to C. Callback code and completion payload live in memory.
4. A transport failure or a C `CAPACITY_EXCEEDED` response offers explicit retry with the same payload. D's retry deadline is the earlier of the original attempt expiry and 60 seconds after D accepts the matching code callback. `Retry-After` can delay a retry within that deadline. An old completion response cannot publish a session. If D received a late refresh credential that it can identify, it requests revocation.
5. C returns opaque access and refresh tokens and `user: { id, name, email }`. The UUID belongs to C. Home renders that profile and sign-out.

D sends HTTP requests only to C, using a 10-second timeout, cookie omission and redirect rejection. Release builds require HTTPS. The adapter strips unknown response fields and reports controlled errors. The private helper restricts requests to literal paths under `/api/mobile/` and sends a Bearer access token. A protected business request is never replayed.

Android development in Expo Go can configure a pair of `exp://` URLs in D. B derives the authorization entry from its advertised Metro `hostUri` and receives the callback in the OAuth request. D's configured callback matches C's `RITA_REDIRECT_URI` and the redirect URI registered in A. The same state, callback and PKCE checks apply. Native builds use the app schemes by default.

See the [C API contract](../mobile-oauth02-example-backend/README.md#hợp-đồng-với-d) for routes and status codes and [device acceptance](README.md#phase-2-acceptance-checklist) for the remaining integration checks.

## Session lifecycle and storage

- `rita_login_attempt_v1` contains the attempt ID, state, verifier, expiry and C origin. It is removed before code submission and when the user cancels, the attempt expires or the app clears a session. If D restarts after clearing the pending attempt from SecureStore and before saving the session, its in-memory completion is lost and the user starts a fresh login.
- `app_backend_session_v3` contains the refresh credential, its absolute expiry, C user UUID and C origin. Access and profile stay in RAM. Legacy demo keys are deleted during initialization. Origin changes or expired records require a fresh login.
- Cold launch restores via refresh and then verifies `/me` before publishing identity. Foreground verification uses the current access token when valid. A transient `/me` error with an existing session hides identity and allows retry.
- Credential rotation is coalesced and saved before requests use the new access token. C revokes the old pair on refresh. An uncertain refresh ends the local session. A current-session 401 ends it, and 403 preserves it. Late 401s from an older access token do not clear a newer pair.
- C's PostgreSQL store preserves unused, unexpired attempts and valid sessions across C restarts. An exchange interrupted before C records the result may require a fresh login when its lease expires. C's own replay window lasts 60 seconds from session issuance. Replaying a recorded completion after C restarts requires the same C replay key and time remaining before both the D retry deadline and the C replay deadline.
- Sign-out invalidates in-flight work, clears SecureStore and attempts server revocation. An unconfirmed revocation is reported separately. Storage deletion failure blocks another sign-in until cleanup succeeds.
