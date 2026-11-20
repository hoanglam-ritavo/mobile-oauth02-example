# Mobile example architecture

[Setup and verification](README.md) · [Agent guidance](AGENTS.md)

D is Rita Partner Demo, an Expo Router app for Android and iOS. D opens B at `rita-id://oauth/authorize` and handles `rita-partner-demo://redirect` with its own native app identifiers. C owns confidential code exchange, user mapping and the D session. A is the Rita Võ ID Backend. See [B's native authorization flow](../rita-id-app/ARCHITECTURE.md#partner-mobile-authorization) and [A's OAuth boundary](../rita-id-backend/ARCHITECTURE.md#partner-mobile-authorization). Web preview uses the existing web runtime and has sign-in disabled.

## Ownership

| Area | Responsibility |
| --- | --- |
| [Auth context](src/context/auth-context.tsx) | Attaches the native callback listener and foreground verification to the root. UI calls sign-in, retry, sign-out and private requests through `useAuth`. |
| [AuthSession](src/services/auth-session.ts) | Owns login/refresh state, generation checks, timers, coalescing, and serialized SecureStore operations. |
| [Native runtime](src/services/auth-runtime.ts) | Injects Expo Crypto, Linking and SecureStore. Handles initial URLs and URL events through one coordinator. |
| [OAuth helpers](src/services/oauth-flow.ts) | Builds the fixed B app link from the C-issued parameters. Validates the exact callback URI and state. |
| [C adapter](src/services/backend-service.ts) | Starts and completes login, refreshes and logs out, validates application profiles, and authorizes private requests. |
| [Storage](src/services/session-storage.ts) | Owns the separate, versioned allowlists for refresh credentials and pre-callback attempts. |
| [Native intent](src/app/+native-intent.tsx) | Routes the callback to Home without copying OAuth query fields into the navigation state. Native Linking still receives the original URL. |

## Authorization and HTTP boundaries

1. D generates a cryptographic PKCE verifier and posts its S256 challenge to C. D validates C's attempt ID, state, expiry, client ID, scope and exact registered callback.
2. D persists the pending attempt before opening `rita-id://oauth/authorize`. A matching callback can finish after D is relaunched. The local pending record is bound to C's origin and capped at 10 minutes.
3. D accepts the first callback with the exact URI, matching state and a single code or error. Invalid and duplicate URLs leave the active flow safe. D removes the stored attempt before sending the completion to C. Callback code and completion payload live in memory.
4. A transport failure or a C `CAPACITY_EXCEEDED` response offers explicit retry with the same payload. The local retry window ends no later than 60 seconds after the first completion attempt and respects the original attempt expiry and Retry-After. An old completion response cannot publish a session. If D received a late refresh credential that it can identify, it requests revocation.
5. C returns opaque access and refresh tokens and `user: { id, name, email }`. The UUID belongs to C. Home renders that profile and sign-out.

D sends HTTP requests only to C, using a 10-second timeout, cookie omission and redirect rejection. Release builds require HTTPS. The adapter strips unknown response fields and reports controlled errors. The private helper restricts requests to literal paths under `/api/mobile/` and sends a Bearer access token. A protected business request is never replayed.

See the [C API contract](../mobile-oauth02-example-backend/README.md#hợp-đồng-với-d) for routes and status codes and [device acceptance](README.md#phase-2-acceptance-checklist) for the remaining integration checks.

## Session lifecycle and storage

- `rita_login_attempt_v1` contains the attempt ID, state, verifier, expiry and C origin. It is removed before code submission and when the user cancels, the attempt expires or the app clears a session. A restart after the code was accepted requires a fresh login.
- `app_backend_session_v3` contains the refresh credential, its absolute expiry, C user UUID and C origin. Access and profile stay in RAM. Legacy demo keys are deleted during initialization. Origin changes or expired records require a fresh login.
- Cold launch restores via refresh and then verifies `/me` before publishing identity. Foreground verification uses the current access token when valid. A transient `/me` error with an existing session hides identity and allows retry.
- Credential rotation is coalesced and saved before requests use the new access token. C revokes the old pair on refresh. An uncertain refresh ends the local session. A current-session 401 ends it, and 403 preserves it. Late 401s from an older access token do not clear a newer pair.
- Sign-out invalidates in-flight work, clears SecureStore and attempts server revocation. An unconfirmed revocation is reported separately. Storage deletion failure blocks another sign-in until cleanup succeeds. C's RAM-only session state is lost on restart.
