# Mobile example agent guidance

## Scope and reading order

This file applies to `oauth02-mobile-integration-example` and its descendants. Read [README](README.md) for setup, commands and verification, then [ARCHITECTURE](ARCHITECTURE.md) for runtime flows. Inspect implementation before editing; dated documentation may lag behind the working tree.

The sibling Web Example (application backend B), Rita ID backend, portal and main app are separate projects. Read them when needed to verify integration facts, but change them only when the task includes them. Preserve unrelated changes, including uncommitted and untracked files. Do not copy NestJS/backend conventions into this Expo project.

## Navigation

| Location | Purpose |
| --- | --- |
| `app.json`, `package.json`, `tsconfig*.json` | Expo/native settings, actual npm scripts and application/test TypeScript configuration. |
| `src/app/` | Root provider/layout, Login, Home, Explore and redirect route. |
| `src/context/auth-context.tsx` | UI actions, state subscription, startup and foreground verification. |
| `src/services/auth-session.ts` | Session lifecycle, generation checks, handoff/retry and storage serialization. |
| `src/services/auth-runtime.ts`, `auth-runtime.web.ts` | Native dependency wiring and explicit web-auth rejection. |
| `src/services/oauth-flow.ts` | PKCE and exact, one-use callback/state validation. |
| `src/services/auth-service.ts`, `backend-service.ts` | Rita code exchange, B requests, transport and response validators. |
| `src/services/session-storage.ts` | SecureStore record and legacy credential cleanup. |
| `src/constants/`, `src/components/`, `src/hooks/` | Public configuration, palettes, platform UI and theme helpers. |
| `test/contracts.test.ts`, `test/session.test.ts`, `test/fixtures.ts` | Node test runner contracts, lifecycle regressions and fictional dependencies. |
| `docs/` | Phase-1 A–B contract and preserved historical README. |

## Change conventions

- Keep UI actions behind `useAuth`, context wiring, AuthSession and the transport/storage adapters. Components must not handle X or OAuth tokens directly. Keep dependencies injectable so session behavior remains testable without native modules or real services.
- Centralize environment parsing in `src/constants/config.ts`. Expo requires static `process.env.EXPO_PUBLIC_*` references for substitution. Update parser, types, example env and README together when configuration changes are authorized. All public env values ship in the bundle; never add a client secret.
- Preserve runtime validation of network and storage data. TypeScript interfaces do not validate incoming JSON. Keep public profile `sub`, UI `_id`, employee_id and OAuth clientId distinct; retain field allowlists and nullable/nested profile semantics.
- Preserve native/web separation. A web preview is not supported web authentication. Changing a scheme or native identifier requires setup documentation and installed-device callback verification.
- Follow nearby TypeScript/import/style conventions. Both relative imports and `@/` aliases exist; avoid unrelated conversion, formatting or strictness changes. Keep dependencies and npm lockfile aligned only for authorized dependency changes; do not introduce another package manager.
- Do not edit local `.env`, generated `android/`, `ios/`, `.expo/`, export output or dependencies as implementation source. Never print or commit credentials, private keys, tokens, X or real account data. Use fictional fixtures. Existing debug logging is a documented gap, not permission to log sensitive data.

## Authentication contracts to preserve

- A is a public PKCE S256 client: exact registered callback, cryptographic state/verifier, one-use callback consumption and finite acceptance window. Do not add a confidential-client secret or direct-token fallback.
- A exchanges the code with Rita ID and holds tokens only in RAM until handoff. B owns refresh/revoke and returns X. Do not persist OAuth tokens or profiles, decode JWTs in UI, or substitute browser cookies for mobile Bearer sessions.
- Preserve the versioned SecureStore allowlist, legacy-key cleanup, origin binding, expiry/UUID checks and verification before publishing identity. Failed cleanup must block new login until deletion succeeds.
- Keep the fixed handoff deadline, identical retry payload, explicit retries and Retry-After handling. Do not replay private requests or introduce mobile OAuth refresh. Retain 401 session-ending semantics and 403 permission semantics.
- Preserve generation checks, coalesced verification/logout, serialized storage operations and best-effort closing of known late X. Test cancellation during HTTP and storage operations when modifying this behavior.
- Keep HTTP timeout, cookie omission, redirect rejection, sanitized errors and private-path restrictions. Validate unknown resource responses at the caller. Do not imply every method supported by the helper exists at every B route.
- Check [B's implementation guide](../oauth02-web-integration-example/docs/mobile-backend.md) before describing server behavior. The [phase-1 contract](docs/mobile-backend-contract.md) contains historical status and stronger pair-binding requirements than B currently proves. Source inspection and A mocks cannot establish original-grant binding, full OIDC, production readiness or live compatibility.

## Validation and reporting

Run commands from the mobile root using installed dependencies:

```powershell
npm run typecheck
npm test
git diff --check
```

`typecheck` covers application and test configurations. `npm test` uses `tsx --test test/*.test.ts`, not Jest. For a focused run use `node node_modules/tsx/dist/cli.mjs --test test/contracts.test.ts` or `test/session.test.ts`. Tests inject browser/HTTP/storage/clock and use fictional data; never load local secrets or contact live services merely to validate documentation.

Match verification to the change:

- Documentation only: check local links/heading anchors, npm commands against the relevant package, source claims and diff whitespace. Record source inspection separately from executed runtime checks.
- Auth/config/storage behavior: run affected tests, typecheck and the complete small test suite when shared lifecycle contracts are affected. Cover failure and concurrency behavior rather than mirroring implementation.
- UI/native behavior: typecheck and the relevant regression suite; follow README's theme, layout, large-text and accessibility checklist. Export when bundling is affected, using README's fictional-env command. Export success is not device/callback success.

`npm run lint` invokes Expo lint, but no established project lint gate/config is supplied; do not claim it is a passing gate or let it install/configure tooling incidentally. `reset-project` changes the project and is not a migration or validation command. Do not add missing scripts or dependencies solely to make a documentation command appear valid.

B's compatibility suite runs from B and is separate from mobile tests; follow its own guidance if the task includes it. Native builds, real OAuth smoke tests and server startup require a suitable authorized environment. On Windows, report iOS verification as unavailable unless performed elsewhere. Report failures, skips, unrun checks and subprocess/environment limits honestly; do not weaken assertions or repair unrelated failures to obtain green results.

## Documentation maintenance

README owns full env/command setup, operator acceptance and the fixed [Current verification status](README.md#current-verification-status). ARCHITECTURE owns component responsibilities, interfaces, flows, storage and known limits. This file owns development workflow and validation rules. Cross-link rather than duplicate complete inventories.

Update affected documents alongside changes to behavior, config, native setup, navigation or commands. Preserve historical verification snapshots and their anchors, label obsolete guidance and never present earlier pass counts as fresh results. New verification records need the date, revision/working-tree scope, actual outcomes and mock-versus-native/live limits. Distinguish observed behavior from desired safety contracts; document unrelated gaps without silently changing runtime.
