# Per-API-Key Configuration Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task by task. The user's pasted specification authorizes implementation in this session.

**Goal:** Persist and enforce optional API-key policies without changing existing key secrets or unrestricted defaults.

**Architecture:** Extend the existing SQLite API-key record with JSON policy and usage state. A shared request policy wrapper authenticates, reserves quota/rate capacity transactionally, and scopes actual usage accounting to the request. Model resolution checks aliases and combo members before forwarding. The administrator dashboard owns all keys; settings routes follow dashboard-session authorization.

**Tech Stack:** Next.js 16, React 19, JavaScript, existing SQLite adapters, Vitest.

**Spec:** User attachment `Pasted text.txt`, sections 1–24.

## Global Constraints

- Legacy keys have unlimited quotas/rates, multiplier 1, no expiry, all supported endpoints and models.
- Settings responses never include a secret; settings identify keys by internal ID.
- Raw analytics tokens remain unchanged; policy counters use multiplied tokens and cost.
- UTC calendar hour/day/week (Monday)/month boundaries; lifetime does not reset.
- Reuse the dashboard's design tokens and model picker. ENERGY 1 / RHYTHM 1 / MOTION 1.
- Reject explicit output limits above the configured cap; insert the cap when absent.
- Missing pricing with a cost quota fails closed with a useful error; unrestricted keys retain existing behavior.

## Review Focus

- Aliases, context suffixes and combo fallback must not bypass blocked models.
- Simultaneous requests reserve capacity before forwarding; failures release reservations.
- Streaming completion/cancellation must settle usage without buffering the response.
- Invalid settings, malformed JSON and dashboard authentication fail safely without exposing secrets.
- Database export/import retains settings and counters; migration is additive and repeatable.

### Task 1: Persistent policy and accounting

Files: `src/shared/constants/apiKeyPolicy.js`, `src/lib/apiKeyPolicy/`, `src/lib/db/schema.js`, `src/lib/db/migrations/002-api-key-policy.js`, API-key repository and database export/import.

- [x] Write and run failing tests for validation, defaults, calendar reset, quota/multiplier, rate reservations, and legacy migration.
- [x] Add shared settings defaults/enum and server validation; add additive schema migration and JSON persistence.
- [x] Implement transactional admission and actual usage settlement using internal IDs.
- [x] Run policy/database tests and inspect migration preservation of original secrets.

### Task 2: Gateway integration and settings API

Files: shared policy wrapper/context, existing SSE handlers/model resolution, usage repository, `/api/keys/[id]`.

- [x] Write and run failing gateway/settings tests for expiration, endpoint/model access, output caps, authorization and sanitized responses.
- [x] Wrap existing request handlers, enforce resolved models, and integrate raw usage accounting.
- [x] Cover auxiliary supported routes and native Gemini requests; preserve error responses through format adapters.
- [x] Add GET/PATCH settings and strict PUT validation using existing administrator authorization.
- [x] Run integration tests including streaming, alias/combo and concurrent request cases.

### Task 3: Dashboard configuration

Files: `ConfigureApiKeyDialog` and setting sections under endpoint components, `EndpointPageClient.js`.

- [x] Add Configure action and a full-width shared modal with named settings sections.
- [x] Use existing multi-select model picker, endpoint checkbox cards, UTC-safe expiry conversion, empty unlimited fields, save/error notifications.
- [x] Verify persistence after refresh and click through fields at desktop/mobile sizes in both themes.

### Task 4: Final verification

- [ ] Run available type/syntax checks, lint, relevant tests, and production build.
- [x] Review full diff and security-sensitive boundaries; fix implementation regressions.
- [ ] Record evidence, operational semantics, and any pre-existing verification failures.

## Design decisions

- Existing neutral theme variables, fonts and radii keep configuration native to the dashboard.
- Two-column fields collapse to one column so related limits are scannable on desktop and usable on phones.
- The shared modal keeps its header/footer outside the scroll body so Save/Cancel remain available.
- Existing settings icon identifies the new action; selected model chips and endpoint checkboxes communicate real permissions.

## Verification evidence

- Feature suites: 80 passing Vitest tests across policy, database, gateway, and settings routes. Migration is repeatable and preserves legacy IDs/secrets. Regression cases include quota boundaries, independent admissions, aliases/combos, Gemini Audio permission, long-running TPM reservations, chunked/large JSON usage, canonical cache costs, and sanitized settings.
- Full unit suite: 2,703 passes, 99 failures. Compared against an archived checkout of the original HEAD with the same dependencies: the same 99 failures, no new failed test names. Existing failures include Windows filesystem/path assumptions, missing unrelated dependencies, and stale source/mocks.
- Full source ESLint: 139 errors on both original HEAD and implementation. New policy/constants/migration/dialog modules have no lint findings. JavaScript project check passes using `tsc --noEmit`, `allowJs`, JSX preservation, existing aliases, and explicit `src`/`open-sse` includes; the repository has no dedicated typecheck script.
- HTTP verification used the real local Next server and a disposable local OpenAI-compatible mock, with no paid provider calls. Legacy key forwarding, saved policies, cap insertion, multiplier/cost settlement, RPM/Retry-After, endpoint/model/output denial, exhausted quota, expiry on inference/catalog, SSE completion, dashboard authorization, raw analytics/internal IDs, and absence of gateway secrets in server logs all passed. Test keys and provider connections were removed afterward.
- Browser: saved every field, reloaded, and reopened to verify persistence; selected allowed/blocked models with the reused picker; verified Chat-only cards and invalid-save error retention. Desktop modal maximum measured 896px; 375px mobile layout had no horizontal overflow. Dark/light themes and Escape/focus restoration verified. Screenshots are under ignored `.next-ui-check/`.
- Usage ledger and quota use the same SQLite database as keys/analytics. Unpriced cost-limited models fail closed; modality usage without token metadata retains the existing estimation/zero-cost fallback. See `docs/api-key-configuration.md` for operational semantics.
