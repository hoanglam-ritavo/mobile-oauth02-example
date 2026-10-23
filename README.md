# Rita ID Mobile integration example

Expo/React Native example for Android and iOS. This source is application **A**; the sibling OAuth Web Example provides application backend **B**. Rita ID is the identity provider. The current package uses Expo 57, React 19 and React Native 0.86 with Expo Router.

**A requires B's mobile endpoints.** They now exist in the sibling source when mobile mode is enabled. Source availability does not establish live end-to-end compatibility. B is a single-process RAM demo: restart loses sessions, multiple workers are unsupported and production mode is rejected. There is no direct-token fallback or bundled mock server in A.

Read [Architecture](ARCHITECTURE.md) for runtime behavior and [Agent guidance](AGENTS.md) before changing this source.

## Flow

1. A opens Rita ID Portal in the system browser using Authorization Code + PKCE S256.
2. A validates the one-use state and exact `rita-id-app://redirect` callback, then exchanges the code directly with Rita ID.
3. A holds the OAuth token pair only in memory and hands it to B.
4. B validates the handoff and returns an opaque application session key X, expiration and verified profile.
5. A stores only X and session metadata in SecureStore. All subsequent profile/private/logout requests go to B with `Authorization: Bearer X`.

B owns OAuth token refresh/revocation. A does not decode JWTs or call Rita ID userinfo, refresh or logout. Rita ID's browser SSO cookie is not logged out when A signs out.

The [A–B contract](docs/mobile-backend-contract.md) records phase-1 fields and requirements. Its claim that B is not implemented is historical. Consult [B's current mobile guide](../oauth02-web-integration-example/docs/mobile-backend.md) for implemented behavior and the accepted limit of token validation: identity/client/scope consistency does not prove both original tokens belong to the same grant. Neither document establishes full OIDC support. Sibling links assume the standard adjacent checkouts.

## Configuration and native setup

Use Node.js 24 and the committed npm lockfile. From this mobile project root:

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Create `.env` from `.env.example` only if it does not already exist. Existing local `.env` is not migrated automatically.

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_RITA_BASE_URL` | Rita ID portal origin, e.g. `https://id.example.com`; API base is this origin plus `/api`. |
| `EXPO_PUBLIC_APP_BACKEND_BASE_URL` | Application B origin, e.g. `https://app.example.com`; mobile paths include `/api/mobile`. Required. |
| `EXPO_PUBLIC_OAUTH_CLIENT_ID` | Registered **public** mobile client ID; must also be allowed by B. |
| `EXPO_PUBLIC_OAUTH_REDIRECT_URI` | Exactly `rita-id-app://redirect`; this is also the parser default when omitted. |

Both base URLs are origins only: no path, credentials, query or fragment. HTTP is accepted only in the development runtime; release builds require HTTPS for both origins. Every `EXPO_PUBLIC_*` variable is public bundle data. Never add a client secret.

Use a device-reachable Rita Portal origin whose `/api` routes reach Rita ID Backend. A appends `/api` itself; do not put that path into either origin variable. Proxy configuration belongs to the portal/server deployment.

### Start application backend B

In a separate terminal, from the sibling `oauth02-web-integration-example` root:

```powershell
npm ci
if (!(Test-Path .mobile.env)) { Copy-Item .mobile.env.example .mobile.env }
# Configure the new file before starting the server.
npm run dev:mobile
```

Set B's `RITA_MOBILE_CLIENT_ID` to A's `EXPO_PUBLIC_OAUTH_CLIENT_ID` and configure B's `RITA_API_URL` to reach Rita ID from the server. The mobile template uses port `3004` and `HOST=127.0.0.1`; the web template uses `3003`. The mobile profile reads `.mobile.env`, not the legacy `.env`. See [B's profile setup](../oauth02-web-integration-example/README.md#separate-mobile-process-and-legacy-startup) for precedence and compiled startup commands.

For the standard Android emulator, A can use `http://10.0.2.2:3004` to reach B on the host. For a physical device, use `http://<computer-LAN-IP>:3004`, bind B to a reachable interface (for example `HOST=0.0.0.0` in a controlled local test) and allow the port through the firewall. `0.0.0.0` is a bind address, not A's destination. A physical device's `localhost` refers to itself. Apply the same device-reachability rule to the Rita Portal origin; use its actual configured port.

### Build and run A

Register the exact mobile callback and a public client with `authorization_code` and `refresh_token` grants and `openid profile email` scopes in Rita ID before live testing. The browser example's confidential client is a separate client; do not reuse its secret. Do not assume the portal UI provisions public clients; use the supported provisioning process for your Rita ID environment.

Android requires the Android SDK, compatible JDK, Android tooling and an emulator or connected device. iOS requires macOS, Xcode and appropriate signing; it cannot be built on this Windows host.

```powershell
npm run android
# Requires macOS, Xcode and appropriate signing:
npm run ios
```

Native callback acceptance needs a build with the registered URL scheme, not Expo Go. Restart Metro after changing public environment variables. Rebuild/reinstall when changing a native scheme. `app.json` registers `rita-id-app` and Android package `com.kompact.ritaidapp`. `npm start` starts Metro; `npm run web` starts the web preview, where sign-in is deliberately unsupported.

## Sessions and application requests

Only X and session metadata are persisted in SecureStore. Legacy OAuth-token records require a new login. Startup and foreground verification hide identity until B validates the session. See [session lifecycle and storage](ARCHITECTURE.md#session-lifecycle-and-storage) for the exact record, migration behavior and failure handling.

Components can call `useAuth().request('/api/mobile/private/example')` for B's existing GET demo resource. The helper supports GET/POST/PUT/PATCH/DELETE for resources that implement those methods, returns unknown JSON for callers to validate and hides X. Only literal `/api/mobile/` resource paths are accepted; auth paths, query strings, encoded paths and external URLs are rejected. There is no dedicated private-resource screen; Home renders the verified profile.

A 401 ends the application session; A never refreshes or replays resource requests. A 403 is a permission error. Temporary verification failures hide identity and allow retry. Handoff failures may offer a manual retry within two minutes. Sign-out clears local state and reports when server revocation cannot be confirmed; failed local cleanup requires retrying sign-out before a new login.

## Validation

### Home screen presentation

The signed-in Home screen follows the system light/dark theme, with a compact
initials profile, selectable account values and collapsed **Integration details**
(local UUID, raw group and developer access). Sign out remains the existing
session action. Native tab colors and the signed-in status bar match the Home
palette; Login, Explore content and authentication contracts are unchanged.

Native tabs handle the bottom safe area; Home adds Android top/side insets and
uses automatic scroll insets on iOS. Large system text or narrow screens stack
the profile vertically. Missing profile values display an em dash.

Manual visual acceptance: check Android/iOS in both themes at approximately
320/390/430 logical-pixel widths, including long names/emails, empty values,
expanded UUID, 200% text size, screen-reader disclosure state, tab switching and
sign-out. Use fictional profiles; do not capture real account data for fixtures.

```powershell
npm run typecheck
npm test
git diff --check
```

Tests use injected HTTP/browser/storage/clock and a fake B. They do not load `.env`, contact Rita ID, or prove B's token validation/rotation or browser compatibility. No dependency upgrade or database migration is needed.

Export with fictional release origins, without local `.env`:

```powershell
$env:EXPO_NO_DOTENV='1'
$env:CI='1'
$env:EXPO_PUBLIC_RITA_BASE_URL='https://id.example.invalid'
$env:EXPO_PUBLIC_APP_BACKEND_BASE_URL='https://app.example.invalid'
$env:EXPO_PUBLIC_OAUTH_CLIENT_ID='fictional-mobile-client'
$env:EXPO_PUBLIC_OAUTH_REDIRECT_URI='rita-id-app://redirect'
node node_modules/expo/bin/cli export --platform android --platform ios --output-dir dist-auth-check --max-workers 2
```

Run these environment assignments in a dedicated shell; they override only that process/session. Exports validate bundling, not installed-device behavior. Expo lint has no established project gate here; do not use `reset-project` as a migration command.

## Current verification status

Documentation maintenance on **2026-10-23**, against revision `a874e33` plus the existing uncommitted mobile working tree. This task changes only README, ARCHITECTURE and AGENTS; sibling B was inspected read-only.

- Source inspection: configuration, package commands, UI/session/adapters and existing tests were checked; B's mobile routes and profile template exist. This is not a live integration result.
- Local Markdown links and heading anchors: passed, 34 references across all three files, using a read-only Node check.
- Documented npm commands: 16 occurrences matched the owning project's package scripts; referenced local command/setup paths exist. Commands were inspected, not executed as runtime checks.
- `git diff --check`: passed before and after edits with LF/CRLF conversion warnings. The new untracked documents were also checked directly for whitespace errors.
- SHA-256 comparison of tracked and non-ignored untracked files outside the three-document scope: unchanged from the start of this task.
- Typecheck, tests, Expo export, native builds/devices, real Rita ID/HRM and browser flows were not rerun for this documentation-only change. Historical test counts below are not new results.

### Historical verification snapshots

The following records are preserved from earlier work. References to phase 2 being future work describe the state at that time, not the current B implementation.

Home presentation verification on **2026-10-23**, against the existing uncommitted
mobile working tree plus Home, palette, native-tab and signed-in status-bar changes:

- `npm run typecheck`: passed for application and tests.
- `npm test`: passed 52/52, zero failures/skips, using existing mocked session and
  transport suites. The initial sandbox run failed to spawn test processes
  (`EPERM`); the permitted rerun passed.
- `git diff --check`: passed, with LF/CRLF conversion warnings.
- Calculated sRGB contrast for main/secondary/brand text against screen, card and
  accent backgrounds: minimum 5.20:1 in light mode and 5.91:1 in dark mode.
- Native visual screenshots, 200% text, TalkBack/VoiceOver and live sign-out were
  not executed. An Android emulator was detected, but no fictional-profile UI
  harness was configured. iOS device validation was not performed on this Windows
  host. The existing mock tests do not establish UI rendering or native inset behavior.

The following phase-1 results predate the Home presentation changes; exports were
not rerun for this UI change.

Phase-1 verification on **2026-10-23**, against revision `a874e33` plus this uncommitted mobile-only working tree (auth/services, UI session actions, tests and documentation):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed for application and test TypeScript. |
| `npm test` | Passed 52/52; no failures or skipped tests. HTTP/browser/storage/B are mocked. |
| Android/iOS Expo export | Passed with fictional HTTPS origins and `EXPO_NO_DOTENV=1`; 1626 Android and 1536 iOS modules. Ignored output: `dist-auth-check/`. |
| `git diff --check` | Passed; Git emitted LF/CRLF conversion warnings only. |
| Local Markdown file links | Passed for README, contract and historical README. |

Initial sandbox test/export attempts failed with subprocess `spawn EPERM`; permitted reruns passed. Metro emitted non-failing NO_COLOR/FORCE_COLOR warnings. No dependencies, lockfile, local `.env`, native scheme or sibling source were changed. Live B endpoints, native build/install/callback, real Rita ID/HRM and browser example verification remain untested and outside this phase. B's validation, persistence, idempotency and refresh implementation must be verified in phase 2.

## Phase-2 acceptance checklist

This section retains its original anchor; it is now the live integration acceptance checklist. With B's mobile profile enabled, register the public client and device-reachable origins; test login/consent/callback/handoff, restart A, private request, expired Rita access token refreshed by B, logout and another account. Also test lost handoff response, refused consent, foreground without network, invalid X, permission denial, B restart and session expiration.

B must preserve its existing browser routes/cookies/CSRF flow and test it separately. A successful mobile mock suite does not establish those properties.

B provides `npm run test:mobile-compat` from its own root. It exercises A's adapter against local B and a fictional provider, not the native UI or real Rita ID. Consult [B's verification guidance](../oauth02-web-integration-example/docs/mobile-backend.md#validation-and-live-acceptance) for that separate check; it was not run for this documentation update.

## Historical documentation

The [pre-phase-1 README](docs/history/README-before-backend-session.md) preserves dated checks and former direct-token instructions. Its refresh/logout, storage and configuration guidance is obsolete for the current implementation and is retained only as history.
