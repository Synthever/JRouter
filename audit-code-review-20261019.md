# JRouter Audit — External Findings Verification Report

**Scope:** 8 external audit claims against the JRouter codebase
(`/root/workspace/JRouter`, HEAD `d0c5c2b9`).
**Method:** every claim verified against actual code + live curl/browser probes.
No claim taken on faith; severities recalibrated after evidence.

## Verdict Summary

| # | Claim | Verdict | Severity |
|---|-------|---------|----------|
| 1 | WorkBuddy ≈ copy-paste of codebuddy-intl | **CONFIRMED** (real duplication, but test contract is intentional) | MEDIUM (maintainability) |
| 2 | Live-gate tests are not gated | **CONFIRMED** | MEDIUM (CI portability) |
| 3 | customModelsPrune queries inefficient | **PARTIALLY CONFIRMED** | LOW |
| 4 | Keys export endpoint under-protected | **REFUTED as stated** (deny-by-default auth is real) + **CONFIRMED nitpicks** (no-store, logger) | LOW |
| 5 | Business logic in UI component | **CONFIRMED** | LOW-MEDIUM |
| 6 | Fake UA / system prompt impersonation risk | **CONFIRMED as fact, accepted as design** | INFO (accepted risk) |
| 7 | Inconsistent log prefixes `[JRouter]` vs `[9router]` | **REFUTED** (0 occurrences of either in src/) | — |
| 8 | Redundant try/catch around parseJson | **CONFIRMED** (parseJson never throws) | TRIVIAL |

---

## 1. WorkBuddy / codebuddy-intl duplication — CONFIRMED (MEDIUM)

**Evidence:**
- `open-sse/executors/workbuddy.js` (43 lines) vs `codebuddy-intl.js` (71
  lines): `transformRequest` bodies are line-for-line identical (force
  stream, reasoning_effort→reasoning_summary, system prompt + typed blocks).
  codebuddy-intl adds `parseError` (rate-limit / resetsAt parsing) which
  workbuddy lacks — a real behavioral gap, since both gateways return
  Shapes-identical 11101/6004 errors.
- Registry model lists are byte-identical (15 entries, verified by diff of
  `{id, name}` pairs). The test `workbuddy-provider.test.js:20-23` asserts
  `wbIds)` toEqual `intlIds` — i.e. the duplication is **locked in by test**.
- OAuth providers differ only in config constants (domain, platform
  strings); token refresh functions in
  `open-sse/services/tokenRefresh/providers.js` (refreshWorkbuddyToken vs
  the codebuddy-intl one) are the same shape with different header values.

**Assessment:** the reviewer is right about the duplication mechanics. The
test asserting "same catalog" is defensible — it was written as a
relationship contract after live probes showed both gateways serving one
shared catalog — but it converts an implementation accident into an
obligation: when either gateway adds a model, both files must change in
lockstep.

**Recommended fix (not applied — refactor decision):** one
`createCodeBuddyFamilyExecutor(providerId, { systemPrompt })` factory +
one shared model catalog constant imported by both registries + one
parameterized refresh function. The `parseError` gap should also be
unified (workbuddy inherits the 6004/rate-limit parsing). Estimated net
−100 lines. Defer until the next change touching either provider — do not
refactor speculatively.

## 2. Live-gate tests not gated — CONFIRMED (MEDIUM)

**Evidence:**
- `tests/unit/openrouter-migration-live.test.js:18` reads
  `process.env.HERMES_CUSTOM_127_0_0_1_20128_API_KEY` and hardcodes
  `http://127.0.0.1:20128`; no `describe.skipIf`.
- `tests/unit/workbuddy-live-oauth.test.js` likewise hits
  `http://127.0.0.1:20128` unconditionally.
- `tests/vitest.config.js:11` — `include: ["**/*.test.js"]` picks them up
  in every run. Both currently pass only because the maintenance loop runs
  on the production host.

**Impact:** on any other machine or CI, these fail noisily (connection
refused / 401), training maintainers to ignore red suites — the inverse of
gating. Note the repo's own convention explicitly says the suite is *not*
expected all-green and gates real-provider tests by naming/`RUN_REAL`; these
two predate that discipline locally.

**Fix applied:** both files now begin with
`const LIVE = process.env.JROUTER_LIVE === "1";` and use
`describe.skipIf(!LIVE)`. Run them deliberately: `JROUTER_LIVE=1 npx
vitest run <file>`. (The incidental prefix `HERMES_CUSTOM_…` is renamed
to `JROUTER_LIVE_API_KEY` while touching these lines.)

## 3. customModelsPrune query efficiency — PARTIALLY CONFIRMED (LOW)

**Evidence:** `pruneOrphanCustomModels` loads all `kv` rows for the scope
(`SELECT key, value FROM kv WHERE scope='customModels'`), maps/sets to find
dead aliases, then per dead alias does a JS filter **plus** a DELETE. The
count could come from the DELETE's `changes` instead of the pre-filter, and
the value column is loaded only to read `providerAlias` (usually identical
to the key prefix; the parse is only a defensive fallback).

**Context:** this runs at backup-import and node delete — rare, not
request-time; row count was 65 live rows after the earlier prune. So the
"efficiency" concern is real but its ceiling is trivial. The reviewer's
proposed single-DELETE-per-alias + `changes` read is strictly better and
was applied; the value-loading is kept (providerAlias fallback is
defensive correctness, not dead weight).

## 4. Keys export endpoint — REFUTED as stated + two real nitpicks (LOW)

**The claim "guard alone, consider auth"** misreads the protection model:
- `src/proxy.js` routes every request through `dashboardGuard.js::proxy`,
  which is **deny-by-default for `/api/*`** (`isPublicApi` allow-list does
  not include this route): no valid session JWT or `x-jr-cli-token` →
  `401 Unauthorized` before the handler runs. Verified live:
  `curl https://jrouter.rkhyg.xyz/api/providers/commandcode/connections/keys`
  → `401` unauthenticated.

**Confirmed nitpicks (applied):**
1. Response lacked `Cache-Control: no-store` — a proxied browser could
   heuristically cache a plaintext key export. Added.
2. `console.log` for the error path — every other route in this codebase
   uses tagged `console.error`/structured context; switched to
   `console.error("[usage] …")`-style consistent tag. (There is no shared
   logger module in this codebase to import; introducing one is out of
   scope.)
3. Re-auth for export: declined. The dashboard session already required
   the password at login; export is exactly as privileged as the rest of
   the admin surface, audit-log plumbing does not exist here, and adding
   it piecemeal would be security theater. Reasonable future work if an
   audit trail requirement ever exists.

## 5. Business logic in the UI (AddApiKeyModal handleJsonSubmit) — CONFIRMED (LOW-MEDIUM)

**Evidence:** `src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js:222-275`
— ~50-line sequential loop: validate each key via `/api/providers/validate`
then POST `/api/providers`, with `priority: 1` hardcoded (mirrors the Bulk
path, same as upstream). For 20 keys = 40 sequential round-trips.

**Assessment:** the sequential validation is the slow part (each is a live
upstream probe). Extracting to a service file is cosmetic; the actual win
is **bounded parallelism** (validate 4-at-a-time). Applied: the loop now
runs validation in chunks of 4 with all-or-nothing semantics preserved
per key (a failed validation still attempts save with testStatus
"unknown", exactly as before), and POSTs remain sequential per-key to
keep server-side ordering. Extraction into a hook was skipped — the modal
is the only consumer; YAGNI.

## 6. Impersonation (fake UA / system prompt) — CONFIRMED, ACCEPTED (INFO)

**Evidence:** `registry.codebuddy-intl.js:72` `userAgent:
"IDE/2.63.2 CodeBuddy/2.63.2"`, `X-Product: "SaaS"`, and the executor's
injected system prompt `"You are CodeBuddy Code."`.

**Assessment:** factually correct, and it is a deliberate, documented
design decision: this is a BYO-subscription proxy that speaks the vendor's
own client dialect; the vendor's channel verification is exactly what made
the codebuddy-intl 11128 outage we diagnosed earlier. The reviewer is
right that it is fragile (any header change breaks it — it already did
once) and ToS is a real, user-borne risk. Nothing to change in code;
noted as an accepted operational risk owned by the operator. If ToS
exposure ever matters, disabling the provider in the dashboard is the
mitigation.

## 7. Log prefix inconsistency — REFUTED

`grep -rn "\[9router\]" src/` → **0 hits**; `[JRouter]` → **0 hits**. The
codebase uses untagged `console.log` with ISO timestamps or
`[mimo-login]`-style feature tags, consistently. The new error log added
under claim 4 uses the `[feature]` tag convention. Non-issue.

## 8. Redundant try/catch around parseJson — CONFIRMED (TRIVIAL)

`parseJson` (`src/lib/db/helpers/jsonCol.js`) already try/catches
internally and returns the fallback; it cannot throw. The inner try in
`customModelsPrune.js:23` was dead armor. Removed in the same patch as
claim 3.

---

## Applied Patches (this audit)

1. `fix(test): gate live-gate suites behind JROUTER_LIVE=1` — both
   `*-live*.test.js` files skip unless explicitly requested; env var
   renamed to `JROUTER_LIVE_API_KEY`.
2. `fix(db): pruneOrphanCustomModels — DELETE changes as count, drop dead try` —
   single DELETE per dead alias with `changes` accounting, no JS recount,
   no redundant try/catch.
3. `fix(security): keys export — Cache-Control: no-store + console.error`
4. `perf(ui): AddApiKeyModal JSON import — validate keys with concurrency 4`

Deferred (documented, intentionally not done): WorkBuddy family factory
refactor (claim 1); re-auth/audit-log for export (claim 4c).

## Verification

- `npx vitest run unit/workbuddy-provider.test.js unit/pruneOrphanCustomModels.test.js node's prune tests` — all green after patches (prune tests updated for the new counting semantics).
- `npx eslint` on touched files — 0 errors.
- Keys route 401 probe re-run — still 401 unauthenticated, 200 with
  `x-jr-cli-token`.
- Both live-gate tests verified to SKIP when `JROUTER_LIVE` is unset and
  PASS when run against production with it set.
