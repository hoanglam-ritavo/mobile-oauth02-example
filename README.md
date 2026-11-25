# Rita Partner Demo

Expo and React Native example for Android and iOS. This source is **D**, the partner app. It opens **B**, the Rita Võ ID App, and uses **C**, the partner backend, for its session. **A**, the Rita Võ ID Backend, issues the OAuth code redeemed by C.

The example opens on Login when signed out and Home when the C session is valid. Home shows the application profile and offers sign-out.

Read [Architecture](ARCHITECTURE.md) for runtime behavior and [Agent guidance](AGENTS.md) before changing this source.

## Flow

1. D creates a PKCE challenge and asks C for a login attempt. It saves the pending attempt in SecureStore before opening B.
2. B returns through the registered callback after handling sign-in and consent. If the user returns to D before signing in, B checks the callback with A and returns `error=access_denied` with the original `state`. Declining consent after sign-in also returns `access_denied` with the original `state`.
3. D checks the callback URI and `state`. A matching cancellation clears the pending attempt in D and skips `POST /api/mobile/auth/session`. If the callback has a valid code, D sends it with the verifier to C. C exchanges the code, maps the Rita employee and returns a pair of C tokens.
4. D stores the refresh token in SecureStore and keeps access and profile in memory. Requests go to C. Sign-out clears local credentials and requests revocation of the C session.

## Configuration and native setup

Use Node.js 24.3 or newer on the Node.js 24 release line and the committed npm lockfile.

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_APP_BACKEND_BASE_URL` | Device-reachable origin of C, e.g. `https://app.example.invalid`. Paths, credentials, queries and fragments are rejected. HTTPS is required in release. |
| `EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL` | URL D opens to enter B's authorization screen. Defaults to `rita-id://oauth/authorize`. |
| `EXPO_PUBLIC_RITA_CALLBACK_URI` | URL B opens to return the result to D. Defaults to `rita-partner-demo://redirect`. |

C supplies the client ID and returns its configured callback as `redirectUri` from `POST /api/mobile/auth/attempts`. D checks that it exactly matches the configured callback before opening B.

For native builds, register `rita-partner-demo://redirect` for C's confidential OAuth client in A and set the same value as `RITA_REDIRECT_URI` in C. Keep `client_secret` in C. All `EXPO_PUBLIC_*` values are public bundle values.

Start C using its [README](../mobile-oauth02-example-backend/README.md). C defaults to port 3005. Android emulator development can point to `http://10.0.2.2:3005`. For a physical device, configure a reachable origin. A localhost address on the phone refers to the phone itself. Use HTTPS for a release and keep development services scoped to a controlled network.

### Expo Go preview

B and D both use Expo SDK 58. Set both variables below in D for Android Expo Go development. The authorization URL must use the exact Metro `hostUri` that B advertises. B derives its own entry from that host and port and takes the partner callback from the OAuth request. Use D's Metro host and port for the callback. Set both URLs without query parameters or fragments and restart D's Metro process after changing the variables.

| Variable in D | Android emulator example |
| --- | --- |
| `EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL` | `exp://10.0.2.2:8081/--/oauth/authorize` |
| `EXPO_PUBLIC_RITA_CALLBACK_URI` | `exp://10.0.2.2:8082/--/redirect` |

Use a dedicated confidential client on a separate development instance of A. Register D's exact `EXPO_PUBLIC_RITA_CALLBACK_URI` as the client's redirect URI in A and set the same value as `RITA_REDIRECT_URI` in C. Configure C with that client's credentials and restart it after changing its environment. Start Metro in separate terminals.

```powershell
# In B
npx expo start --go --port 8081

# In D
npx expo start --go --port 8082
```

Open each project in the same SDK 58 Expo Go app. Switching between the two projects and receiving OAuth callbacks in Expo Go still require device verification. The headless checks cover the URI contract, mocked link delivery and bundling.

If External Mobile reports that the configured `exp://` OAuth links require Android Expo Go development mode, the URI pair passed format validation. Check that you opened the project in Expo Go on Android with a development bundle. The matching-pair error means the URI values themselves need checking.

### Native OAuth handoff

D registers `rita-partner-demo` and the Android package and iOS bundle ID `com.kompact.ritapartnerdemo` in its native builds. The two-way OAuth handoff uses separately installed builds of B and D with their registered native schemes. Device acceptance requires a build of B with the `rita-id://oauth/authorize` route and consent screen. See [B's native authorization flow](../rita-id-app/ARCHITECTURE.md#partner-mobile-authorization). Restart Metro after updating public environment values. Generate native projects from the current manifest and lockfile in a clean working copy before building and installing D. Existing generated Android/iOS projects can retain former scheme, package, and plugin settings.

## Sessions and application requests

A previously opened attempt can be restored on cold launch if the callback arrives before expiry. Only the first valid matching callback can claim it. Once D accepts a code, it clears the pending attempt from SecureStore and keeps the completion payload in memory. If D restarts after that removal finishes and before it saves a session, start a fresh login.

C preserves unused, unexpired attempts and valid sessions when it restarts with the same PostgreSQL database. If C stops during an exchange before recording the result, the attempt may require a fresh login once the exchange lease expires.

D offers an explicit retry after an uncertain completion or a temporary C capacity rejection. D's retry deadline is the earlier of the original attempt expiry and 60 seconds after D accepts the matching code callback. C's replay window lasts 60 seconds from session issuance. After C restarts, retrying a recorded completion requires D to retain the payload, C to use the same `OAUTH_REPLAY_KEY`, and both windows to be open. Refresh rotates both tokens and uncertain refresh requires login again.

Home displays name, email and the C user UUID. Private resources may use `useAuth().request('/api/mobile/me')` or other supported paths under `/api/mobile/`. Auth paths, encoded or foreign URLs, and automatic replay are excluded. See [session lifecycle and storage](ARCHITECTURE.md#session-lifecycle-and-storage).

## Validation

```powershell
npm run typecheck
npm test
git diff --check
```

Tests use fictional profiles and mock native adapters. Export platforms with fictional release values and local dotenv disabled.

```powershell
$env:EXPO_NO_DOTENV='1'
$env:CI='1'
$env:EXPO_PUBLIC_APP_BACKEND_BASE_URL='https://app.example.invalid'
$env:EXPO_PUBLIC_RITA_APP_AUTHORIZE_URL='rita-id://oauth/authorize'
node node_modules/expo/bin/cli export --platform android --platform ios --output-dir dist-auth-check --max-workers 2
```

Use a dedicated shell for these environment assignments. Exports exercise bundling. For UI acceptance check both themes, long names and emails, large system text, accessibility labels and sign-out on installed builds.

## Current verification status

2026-11-25, PostgreSQL restart contract documentation and D session regressions against base revision `387159c`.

- All 47 contract and session tests passed using TypeScript output in a temporary directory and Node's in-process test runner. Coverage includes warm and cold callbacks, state and denial, fresh login after D restarts during completion, explicit retry, terminal restart errors, and profile verification during session restore.
- Test TypeScript and `git diff --check` passed. The application typecheck still reports `TS2367` and `TS2538` in `src/hooks/use-theme.ts`. Device handoff and live OAuth remain pending. C's restart persistence is verified by its own [PostgreSQL tests](../mobile-oauth02-example-backend/test/postgres.test.ts).

2026-11-23, OAuth callback documentation and denial regression against base revision `1b36fdd`.

- All 46 contract and session tests passed using TypeScript output in a temporary directory and Node's in-process test runner. The TSX launcher hit `spawn EPERM` in the sandbox. The denial test verifies that a wrong state preserves the attempt, a matching state clears it without a completion request, and a fresh login can start.
- Test TypeScript and `git diff --check` passed. The application typecheck still reports `TS2367` and `TS2538` in `src/hooks/use-theme.ts`. Installed-device handoff and live OAuth remain pending.

2026-11-21, native-only cleanup against base revision `03d01b8`.

- `npm ci` passed for the baseline and the updated lockfile. Direct runtime dependencies fell from 27 to 16, and installed packages fell from 619 to 589. Typecheck, all 40 tests, and `git diff --check` passed.
- Android and iOS exports passed with the same fictional configuration. Android Hermes bytecode fell from 3,749,345 to 2,757,424 bytes (26.5%). iOS Hermes bytecode fell from 3,543,987 to 2,443,983 bytes (31.0%).
- The generated Android manifest and introspected iOS URL types retained the `rita-partner-demo` scheme and package or bundle ID `com.kompact.ritapartnerdemo`. Installed-device and live OAuth checks remain pending.

2026-11-20, base revision e2772f6 plus the D app-switch and C-session changes.

- Application and test typecheck passed. The Node test suite passed 39/39 using fictional profiles and injected native, storage and HTTP dependencies. Git diff reported no whitespace errors.
- A local HTTP smoke test used D's real adapter, the compiled C service and a Rita stub. It verified one exchange for duplicate callbacks, private profile, cold refresh, sign-out and fresh login after restarting C.
- Android and iOS JavaScript exports passed with dotenv disabled and fictional configuration. Installed-device handoff and live Rita authorization still require B's authorization route and a registered confidential client.

Documentation reconciliation on **2026-11-20**, against the existing D implementation and working tree. Markdown links, heading anchors and documented command paths were checked. The runtime results above remain the record of the earlier implementation checks.

Partner identity update on **2026-11-20**. TypeScript and **40/40 tests** passed, including the native identity and exact callback contract. Expo config introspection in a clean working copy verified the Android intent filter and iOS URL types. Installed-device verification remains open.

### Historical verification snapshots

The following records describe the earlier handoff demo. In those snapshots, A means the partner mobile app (now D), and B means the OAuth Web Example backend used by that demo.

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

Install the B build with native authorization and the new D build and use the [current C contract](../mobile-oauth02-example-backend/README.md#hợp-đồng-với-d). Configure a Rita confidential client and the exact `rita-partner-demo://redirect` callback in A and C. Run the checklist on Android and iOS.

- Complete login with and without an existing B session, and with new and previously granted consent.
- Return to D using the return action on B's login screen while signed out. On Android, also test the system Back action.
- Decline consent in B after signing in. For both cancellation paths, verify `access_denied` with the original `state`, cleared pending state in D, and an initial `/api/mobile/auth/attempts` request with no `/api/mobile/auth/session` request to C. Confirm a fresh login can start.
- Verify warm and cold callbacks while D still has the pending attempt. Restart D after it has cleared the pending attempt from SecureStore and before it saves a session. Verify a fresh login is required.
- Restart C with the same PostgreSQL database and `OAUTH_REPLAY_KEY` after `POST /api/mobile/auth/attempts` and before the first `POST /api/mobile/auth/session`. Verify the unused, unexpired attempt completes normally.
- With the same C restart configuration, verify that D can retry a recorded completion while it stays open and both windows are active. Verify a valid session can call `/me` and refresh with the same C user ID after C restarts.
- Check duplicate callbacks, B absent and logout.

## Historical documentation

The [former mobile handoff contract](docs/mobile-backend-contract.md) and [pre-handoff README](docs/history/README-before-backend-session.md) describe earlier demos. The [current API contract](../mobile-oauth02-example-backend/README.md#hợp-đồng-với-d) belongs to C.
