# Mobile A – backend B contract (phase 1, 2026-10-23)

This document specifies the API consumed by Mobile Example. **The endpoints are not implemented in OAuth Web Example yet.** Phase 2 must implement and verify them without replacing the browser demo. Mock tests in A are client contract evidence only.

## Trust and ownership

A is a public OAuth client using PKCE S256. A directly exchanges the authorization code with Rita ID at `/api/auth/oauth/token` and transfers the returned tokens to B over HTTPS. Only B manages those tokens after accepting the transfer. No confidential client secret belongs in A.

B must allowlist the configured mobile client ID and validate token purpose, RS256 signature/JWKS, expiration, audience and stable Rita identity. Do not trust the submitted `clientId` or profile claims without verification. A successful userinfo response alone does not establish the expected audience. B must establish access/refresh pair consistency before accepting a session and must retain the same subject after rotation. Token pair consistency is a server acceptance requirement, not something A's mock tests establish. Do not treat this specification as proof of full OIDC support.

B must use mobile public-client credentials/contracts for refresh and revoke, never the browser confidential client configuration. Browser and mobile sessions must be distinguishable: mobile APIs accept X via Bearer, not browser cookies, and browser APIs must not accept X accidentally. B applies its own user/permission policies after Rita authentication.

## Endpoints

### POST /api/mobile/auth/session

No Authorization header or cookie. JSON body:

```json
{
  "handoffId": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "clientId": "fictional-public-mobile-client",
  "accessToken": "fictional-rita-access-token",
  "refreshToken": "fictional-rita-refresh-token"
}
```

`handoffId` is a cryptographically random 256-bit lowercase hex value generated once per login attempt. B returns HTTP 200:

```json
{
  "sessionKey": "fictional-opaque-session-key",
  "expiresAt": "2030-01-01T00:00:00.000Z",
  "profile": {
    "sub": "12345678-1234-4123-8123-123456789012",
    "name": "Example Employee",
    "email": "employee@example.invalid",
    "employee_id": null,
    "phone_number": null,
    "is_developer": false,
    "groups": "EMPLOYEE",
    "avatar": null,
    "position": {
      "text": null,
      "parser": {
        "group": "", "company": "", "department": "", "board": "", "region": "",
        "store": "", "warehouse": "", "factory": "", "workshop": "", "showroom": "",
        "center": "", "cafe": "", "others": []
      }
    }
  }
}
```

X is a nonempty opaque credential without whitespace. It must be generated securely by B, have finite server-enforced expiry and support revocation. It is never an OAuth token. Production storage should protect OAuth tokens and use a hash of X for lookups; secure replay storage for handoff responses must be considered separately in phase 2. The existing browser demo's RAM store is not production persistence.

`expiresAt` is B session expiration, UTC ISO 8601 with either seconds or three fractional digits, ending in Z. It is not Rita access-token expiration. B owns the session lifetime policy; A invents no replacement lifetime. A rejects already-expired returned metadata.

### GET /api/mobile/me

Required header `Authorization: Bearer X`. Returns HTTP 200 `{ "profile": <profile above>, "expiresAt": <UTC expiry> }`. B validates the session and refreshes/verifies Rita credentials when its policy requires it. Once authenticated, the subject cannot change for a given X.

All profile fields above are required. String-or-null fields are employee_id, phone_number, avatar and position.text. Parser categories are strings; parser.others is an array of strings. `groups` is EMPLOYEE, CUSTOMER or ENTERPRISE. `sub` is Rita's local UUID, not employee code, numeric HRM ID or B's internal account ID. A maps it to its existing UI `_id` field. Extra fields are discarded, not exposed as trusted identity. No new avatar/position UI is required in phase 1.

### POST /api/mobile/auth/logout

Required header `Authorization: Bearer X`, no request body or cookie. Returns HTTP 200 `{ "loggedOut": true, "revokeConfirmed": true|false }`. B must invalidate X even if Rita revoke fails. A treats HTTP 401 as an already-unusable session and still clears local storage. Failure or false confirmation produces a local sign-out with an explicit server-revocation warning. This does not remove Rita's browser SSO cookie.

### Additional private resources

A exposes `useAuth().request(path, options)` with a method (GET/POST/PUT/PATCH/DELETE) and optional JSON body. Paths must be literal `/api/mobile/` resources outside `/api/mobile/auth/`, containing only ASCII letters, digits, slash, underscore or hyphen. Query strings, duplicate slashes, encoded characters, dot segments, backslashes and absolute URLs are rejected. No caller-supplied headers are accepted. Callers validate unknown JSON responses. A never retries these requests automatically.

## Handoff recovery and concurrency

A starts a fixed 120-second window immediately before the first handoff call and keeps the pair only in RAM. Retry is explicit after network errors, timeout, HTTP 429 or 5xx. `Retry-After` supports delta seconds and HTTP date. No attempt is sent before that time or after the handoff deadline. Foreground checks expire pending attempts; mobile timer suspension cannot extend permission to retry. Closing the process loses the attempt.

B must atomically recognize identical payloads for a handoff ID and return the **same X/session/identity** on replay, even if the original token pair was already rotated during initial acceptance. The original full payload must still be presented and matched; `handoffId` alone is not authorization. Never refresh or create a second session just because a response was lost. A mismatched payload for an existing ID returns 409. Concurrent identical requests must serialize to one result.

B must retain the replay result for at least the 120-second client window plus the 10-second request timeout. It must not replay a revoked session back into validity. Never store or log the original tokens in plaintext for payload matching; use a protected digest/binding and protected replay response storage. B's finite session expiry must also bound abandoned sessions whose X never reached A. Exact server storage implementation belongs to phase 2.

A clears temporary token references on success, cancellation or expiration. A logout/cancel increments a generation so old responses cannot republish state. If a valid X is received after cancellation/deadline or cannot be stored, A attempts B logout. If the response was lost or malformed without a usable key, A cannot reliably revoke that unknown session; B must enforce expiry. A does not attempt Rita revoke after an uncertain handoff, which could invalidate B's accepted session.

## Errors and transport

Every request uses a 10-second timeout, `credentials: omit` and redirect rejection. Both origins require HTTPS outside development. Auth/private responses on B must use no-store and must not echo tokens or X in error bodies or logs.

Errors have JSON `{ "error": "machine_code" }`. A currently branches on HTTP status and shows sanitized local messages; arbitrary server text is never displayed.

| Status | Meaning / A behavior |
| --- | --- |
| 400 | Invalid input: end handoff, new login required. |
| 401 | Invalid OAuth proof or B session: end attempt/session; no mobile refresh. |
| 403 | Permission denied: end handoff; existing sessions are retained for resource errors. Failed profile verification hides identity. |
| 409 | Handoff payload conflict: end attempt, new login required. |
| 429 | Rate limit: explicit handoff retry, honor Retry-After within deadline. |
| 5xx | Service failure: explicit handoff retry; profile verification retains X but hides identity. |

Malformed successful responses are contract failures, not network retries. Known X from malformed handoff responses is closed best-effort. Invalid profile/changed identity during verification closes/discards the local session. Business requests are never replayed, including POST after 401. B must distinguish denied permission, invalid session and Rita outages rather than converting everything into 401.

## Phase-2 verification obligations

Implement B's mobile routes separately from existing browser entrypoints, preserve cookie/CSRF rules and maintain existing browser regression tests. Test wrong audience/client, forged/expired tokens, mismatched access/refresh pairs, subject changes, replay binding, duplicate/concurrent handoffs, refresh concurrency, revoked X replay and failed Rita revocation. A's mocks cannot prove any of these server properties.

Provide a device-reachable B origin and document the demo RAM/restart limitations. End-to-end acceptance then covers consent/callback, handoff, restart A, B refresh, logout, another user, network outages and abandoned handoffs. No production-readiness or live interoperability claim is made by phase 1.
