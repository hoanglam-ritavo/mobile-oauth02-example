# Mobile example agent guidance

## Scope and reading order

This file applies to `oauth02-mobile-integration-example` (D). Read [README](README.md) and [ARCHITECTURE](ARCHITECTURE.md) before changing this repo. A is Rita Võ ID Backend, B is the Rita Võ ID App and C is the separate [Backend C](../mobile-oauth02-example-backend/README.md). Inspect those contracts when needed and change other repos only when the task includes them. Preserve unrelated working-tree changes.

## Authentication and configuration

- Keep authentication behind `useAuth`, AuthSession and the C adapter. Use injectable native linking, clock, storage and transport dependencies. Keep web sign-in disabled.
- D opens B through a native link, generates PKCE S256 and checks one-use callback/state and expiry. Handle cold and warm links through the same coordinator. Keep callback query fields out of Expo Router state. C owns the client secret, OAuth exchange and session issuance. D calls C only.
- Update the public configuration parser, `.env.example` and setup guide together. Keep explicit `process.env.EXPO_PUBLIC_*` reads. Release traffic to C requires HTTPS. Never add credentials, tokens, verifiers, redirect payloads or personal data to logs, examples or fixtures.
- Keep storage records versioned and allowlisted. Pending attempts and C refresh credentials use separate SecureStore keys. Preserve origin/expiry checks, legacy cleanup, epoch checks, serialized writes and revocation of known credentials that arrive after cancellation. A failed delete blocks login until cleanup succeeds.
- Preserve explicit completion retry with the same payload and fixed deadline. Never replay business requests or retry ambiguous refresh. Coalesce refresh and verify, retain 401 session-ending and 403 permission semantics, and keep private path restrictions.
- Keep dependencies and npm lockfile aligned. Use npm. Leave local `.env`, generated native projects, Expo output and dependency directories outside implementation source. Native configuration changes need installed-device verification.

## Validation and docs

- Use `npm run typecheck`, `npm test`, and `git diff --check`. Tests use the Node runner and injected fictional fixtures. Do not contact live services or load real credentials merely to validate fixtures.
- Native acceptance requires Android and iOS builds with the D callback registered and the B route available. Exports establish bundling. See [acceptance checklist](README.md#phase-2-acceptance-checklist).
- README owns setup and [current verification](README.md#current-verification-status). ARCHITECTURE owns runtime boundaries. Preserve historical records and heading anchors. Report checks run and limits accurately.
