# Models Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user has already chosen subagent-driven execution; do not ask them to choose it again.

**Goal:** Add separately persisted Models Aliases with primary-aware adaptive routing, bounded initial response, shared prompt/fusion behavior, and virtual-target-only public LLM access.

**Architecture:** Reuse the existing provider execution and Combo strategy engines behind an exact public-target resolver. Separate persisted configuration from process-local alias runtime state, and separate public invocation catalogs from management member catalogs. Keep alias-only deadline/retry/prompt improvements opt-in through server-owned execution options.

**Tech Stack:** JavaScript ESM/JSX, Next.js 16.3.8, React 19, existing SQLite adapter, Node 26.10.0 for production-matching verification, Vitest 4.1.11, existing browser automation. No new application dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-models-aliases-design.md`, including the planning decisions recorded on 2026-10-11.

## Global Constraints

- Base commit: `129b761fc6c098b29400dc0ec9e72e62d31c9b5a`. Read the full spec and applicable `CLAUDE.md`, `open-sse/AGENTS.md`, `docs/FRONTEND.md`, and `docs/DESIGN.md` before touching their areas.
- New entity/menu: **Models Aliases**, route `/dashboard/models-aliases`. Do not replace legacy `modelAliases` KV mappings or convert Combos into aliases.
- Public IDs: `jrouter/<name>` for aliases and LLM Combos. Accept existing bare LLM Combo names for compatibility. Names and provider model IDs remain case-sensitive; preserve nested slashes.
- Public LLM calls reject provider targets even with otherwise unrestricted credentials, loopback/CLI access, or client-supplied internal flags. Non-LLM behavior remains unchanged.
- New aliases contain provider LLM members only. Primary and explicit judge belong to members. Cross-entity name collisions are rejected in persistence and APIs.
- Default initial member deadline: **15 seconds**, configurable as a finite positive number. Includes preparation/account switching; headers/heartbeat are not valid output. Stop the initial timer at valid text/reasoning/tool output, never replay after that latch.
- Buffered-only transports remain supported: their deadline measures the complete observable answer; expose the limitation to the UI. Request upstream streaming when supported, including for client JSON requests.
- Transient alias cooldown progression: **30, 60, 120, 300 seconds**, success resets; auth/payment classification retains **2 minutes** where applicable; authoritative rate-limit reset/account locks remain enforced.
- Primary is first only for fallback, rotates normally for round-robin, and is default fusion judge. Runtime ordering never edits saved configuration. Single recovery trial per recovering member; restart resets transient state.
- Fusion retains **90-second** collection bound and **8-second** grace after the required **two** usable answers, capped by actual eligible panel size. Reuse a single panel answer without regeneration.
- Alias prompt is composed once; attempt/account bodies are independently cloned. Preserve CodeBuddy alias instructions without changing ordinary Combo behavior.
- Skip PXPIPE only on Models Aliases; preserve global setting and Combo behavior. Other preparatory operations propagate cancellation.
- Existing Combo out-of-member judges/adapters require independent approval from both key-policy systems, never the parent grant. Unrestricted keys retain existing Combo configuration behavior. Alias membership stays confined.
- Both current key policy and legacy access restrictions remain active. Allowed member does not grant parent, blocked member wins, bare/prefixed Combo permissions are equivalent, no automatic policy migration.
- Only virtual targets appear in public LLM discovery and response model fields; raw provider metadata stays available for management/health/media and actual upstream usage attribution stays intact.
- No implementation commit, push, production cutover, live DB mutation, host CLI Apply, proxy change, or real upstream inference is authorized by this plan. Hold changes locally. Leave the existing untracked golden-url-header snapshot untouched.
- Use isolated filesystem/HOME/DATA_DIR and disabled startup jobs for all tests/previews; preserve real runtime `.next` pointer and production credentials.

## Planning decisions and fixed contracts

### Error envelopes

Use existing OpenAI-compatible error helpers. Missing/invalid target is HTTP 400 `invalid_request`; a direct provider LLM target is HTTP 403 `direct_model_not_allowed`; unknown `jrouter/...` is HTTP 404 `model_not_found`; key denial remains HTTP 403 `model_not_allowed` or the existing legacy envelope. A failed provider stream after output is terminal in the client's protocol, not a second generation.

### Redispatch categories

Alias requests disable repeated network/status/capacity/integrity generation retries. Permit at most one bounded refresh plus one redispatch with newly refreshed credentials per account, and deterministic endpoint negotiation only after an explicit pre-output endpoint-unsupported response. They share the same member deadline. One account-scoped budget is shared across proactive refresh, executor auth recovery and chatCore reactive refresh: acquiring fresh credentials proactively consumes its one refresh; an initial session bootstrap from no credential is preparation, but refreshing that session after 401 consumes recovery. Reading an already refreshed DB credential/cache is not a remote refresh. A 401 after the budget is consumed cannot trigger another refresh or generation; move to another account/member only before valid output. Record/test exact counts per executor; do not use `healthProbe=true` as an alias shortcut.

### Dashboard provider tests

Existing authorized provider/model test controls remain management operations. Move their LLM execution to a dashboard-authorized in-process provider callback; do not create a public header/body bypass. A remote inference key alone cannot invoke this callback. Do not change media test behavior.

### Optional/unimplemented routes

Audit only routes present in source. There is no implemented Ollama generate route or `/api/dashboard/chat/completions` handler at this baseline. Do not add those endpoints. The existing hidden Basic Chat UI must use the current public chat endpoint and virtual catalog rather than introduce an exception; Task 15 owns this narrow change without changing appearance/history storage or adding a handler.

### Member metadata

Management member metadata reports `outputObservability: 'incremental' | 'buffered'`. Derive it from actual executor behavior, not alias-name heuristics. This is descriptive metadata, not a new provider/plugin subsystem.

### Shared types (JSDoc, no TypeScript conversion)

```js
/** @typedef {{ id:string, name:string, models:string[], primaryModel:string,
 * strategy:'fallback'|'round-robin'|'fusion', judgeModel:string|null,
 * initialResponseTimeoutSeconds:number, promptInjectionEnabled:boolean,
 * promptInjectionMode:'prepend'|'append'|'replace', systemPrompt:string|null,
 * displayIdentity:string|null, createdAt:string, updatedAt:string }} ModelsAlias */
/** @typedef {{ kind:'alias'|'combo', entityId:string, name:string, requestedId:string,
 * publicId:string, config:Object, members:string[], legacyBareRequested:boolean }} PublicLlmTarget */
/** @typedef {{ requested:string, provider:string, model:string, canonicalId:string }} ResolvedMember */
/** @typedef {{ target:PublicLlmTarget, members:ResolvedMember[], keyAccess:Object|null,
 * policy:Object|null }} AuthorizedLlmTarget */
/** @typedef {{ id:string, value:string, name:string, targetType:'alias'|'combo',
 * caps:{contextWindow:number|null,maxOutput:number|null,vision:boolean,search:boolean,reasoning:boolean} }} PublicCatalogEntry */
/** @typedef {{ aliasId:string, configVersion:string, serverNow:number,
 * configuredOrder:string[], effectiveOrder:string[], members:Array<{
 * modelId:string, status:'available'|'cooldown'|'recovering', retryAt:number|null }> }} AliasRuntimeStatus */
```

Interfaces below are proposed, not claims that the functions already exist. Use these exact names across tasks; parent integration owns changes to a shared contract.

## File responsibility map

- `src/lib/modelsAliases/config.js`: pure name/config validation, configured order/version key.
- `src/lib/modelsAliases/members.js`: asynchronous provider-member resolution/LLM validation using existing DB/registry.
- `src/lib/db/repos/modelsAliasesRepo.js`: new entity CRUD; existing Combo repo guards namespace collisions.
- `src/sse/services/publicLlmTarget.js`: exact public alias/Combo lookup, never provider parsing for external targets.
- `src/lib/apiKeyPolicy/virtualTargets.js`: target identifiers and authorization intersection; existing gateway/context/legacy access integrate it.
- `src/sse/services/modelsAliasRuntime.js` and `modelsAliasFailure.js`: transient order/rotation/recovery/cooldown classification.
- `open-sse/services/aliasAttempt.js`: clearable initial deadline and valid-output latch.
- `open-sse/utils/aliasOutput.js`: semantic output/error observation and replayable initial response gate.
- `open-sse/utils/sharedOperation.js`: cancellable waiters for existing shared refresh/project operations; not a generic workflow framework.
- Existing auth, refresh, project, proxy, executor, stream/JSON collector files: trailing optional signal/execution hooks, preserving default behavior.
- `src/sse/handlers/providerChat.js`: narrowly extracted current private single-provider execution, reusable only by server-authorized callers.
- `src/sse/services/modelsAliasChat.js`: alias orchestration using runtime/attempt contracts and existing strategy engine.
- Existing `open-sse/services/combo.js`: narrow alias-only callbacks for adaptive fallback/fusion; legacy behavior remains default.
- `src/sse/services/publicLlmCatalog.js`: one virtual LLM catalog; raw `buildModelsList` remains the management/media/health builder.
- `src/sse/services/publicLlmResponse.js`: structural public model identity adapter after upstream accounting/translation.
- `/api/models-aliases` routes: dashboard CRUD/runtime/reset; `/api/models/public`: dashboard virtual catalog independent of edited inference key.
- Existing shared picker files: explicit catalog contexts and canonical values; no second picker implementation.
- `/dashboard/models-aliases` page/form/member/runtime components: existing shell/control patterns, no graphical assets.
- Existing public adapters/CLI/key/Playground consumers: virtual target integration without automatic migration.

## Task dependency and file ownership

Task 0 precedes all writes. Tasks 1, 4, and 11 may begin in parallel with exclusive file ownership. Tasks 2/3 depend on Task 1 (both consume configuration/member contracts). Tasks 5/6 follow Task 4; neither edits the same source file concurrently. Task 7 follows Tasks 4/5/6. Task 8 follows Tasks 2/3/7; Task 9 follows Tasks 8/11. Task 10 follows Tasks 1/2 and can proceed beside Tasks 5-8. Task 12 follows Tasks 1/3/6/10 (owns DB-import runtime invalidation integration after Task 3). Task 13 follows Task 10, Task 14 follows Tasks 12/13, Task 15 follows Task 13, and Task 16 integrates all.

Parent stages handoffs in the isolated directory without commits. Only one active writer owns `chat.js`, `chatCore.js`, DB barrel, shared picker files, or each executor at a time. Subagents run narrow tests with unique fixture directories and evidence paths. Every task receives the spec, global constraints, exact upstream/downstream contracts, and its file allowlist.

Review each completed task in fresh contexts: spec-compliance first, then code-quality/security. Reviewers are read-only and return concrete issues; parent verifies actual diff/test evidence and applies transitions. Do not dispatch a blanket refactor or allow children to commit/deploy.

---

### Task 0: Isolate execution and capture baseline

**Files:**
- Read: `CLAUDE.md`, `open-sse/AGENTS.md`, `next.config.mjs`, `scripts/copy-standalone-assets.mjs`, `tests/vitest.config.js`.
- Copy approved spec/plan to execution directory; create only disposable verification fixtures/evidence under `/root/.hermes/cache/scratch/`.
- Never modify `/root/workspace/JRouter/.next`, `.env`, runtime process config, or `/root/.9router`.

**Interfaces:** produces isolated execution root, matching dependency links, baseline test/lint signatures and safe preview command.

- [ ] **Step 1: Resolve live boundaries and use the worktree skill.** Parent loads `using-git-worktrees` at execution time. Create `/root/workspace/JRouter-models-aliases` from the base on `feat/models-aliases`, without a commit. Assert the location is not an active PM2 source/build. Copy only approved untracked docs, not the old snapshot.

```bash
git -C /root/workspace/JRouter worktree add -b feat/models-aliases /root/workspace/JRouter-models-aliases 129b761fc6c098b29400dc0ec9e72e62d31c9b5a
```

- [ ] **Step 2: Compare manifests/ignored lockfiles with active release dependencies.** Resolve live `.next` realpath and its source `node_modules` realpath; verify `package.json` and test manifests byte-identical before reusing dependencies. Root checkout lacks AWS optional deps, so do not default to its incomplete `node_modules`. Never run install through a shared dependency symlink. If installation is needed, copy matching ignored locks and use `npm ci` in a private directory.
- [ ] **Step 3: Establish isolation before importing or running any test.** Use fresh scratch HOME/DATA_DIR/TMPDIR, bootstrap suppression, disabled jobs and network guards from the safety-harness paragraph below before the first Vitest command. Do not read/copy `.env` or production DB; verify resolved DATA_DIR is outside `/root/.9router`. The existing Gemini native suite can reach real keyAccess DB even when it mocks localDb/gateway; its fallback DB must be scratch. All later test/build commands inherit this environment; each subagent overrides its own task-specific scratch DATA_DIR before process start.

```bash
export HOME=/root/.hermes/cache/scratch/jrouter-models-aliases/baseline-home
export DATA_DIR=/root/.hermes/cache/scratch/jrouter-models-aliases/baseline-data
export TMPDIR=/root/.hermes/cache/scratch/jrouter-models-aliases/baseline-tmp
export MODEL_CATALOG_SYNC=off MODEL_HEALTH_SCHEDULER=false
export DISABLE_BACKGROUND_TOKEN_REFRESH=true ENABLE_REQUEST_LOGS=false
export NEXT_TELEMETRY_DISABLED=1
export PATH=/root/.nvm/versions/node/v26.10.0/bin:$PATH
export NODE_OPTIONS=--require=/root/.hermes/cache/scratch/jrouter-models-aliases/bootstrap.cjs
```

- [ ] **Step 4: Capture offline baseline before edits.** Run the explicit existing suite list in Task 16, exclude real/live tests, store JSON under `evidence/baseline-tests.json`. Run lint only on files the task intends to edit and store baseline signatures. Normalize failing tests by relative file path/full test name; the committed verifier assumes `/app/` paths and must not be blindly trusted here.

```bash
node tests/node_modules/vitest/vitest.mjs run --config /root/.hermes/cache/scratch/jrouter-models-aliases/vitest.config.mjs --reporter=json --outputFile=/root/.hermes/cache/scratch/jrouter-models-aliases/evidence/baseline-tests.json --exclude '**/real/**' --exclude '**/*.real.test.js' --exclude '**/*.live.test.js' tests/unit/key-access.test.js tests/unit/key-access-handlers.test.js tests/unit/db-migration-chain.test.js tests/unit/key-access-migration.test.js tests/unit/combo-prompt-settings.test.js tests/unit/api-key-policy-gateway.test.js tests/unit/api-key-policy.test.js tests/unit/model-catalog-compatible-nodes.test.js tests/unit/model-catalog-scope.test.js tests/unit/model-health-discovery.test.js tests/unit/v1-model-lookup-3588.test.js tests/unit/v1-models-combo-context.test.js tests/unit/v1-models-available.test.js tests/unit/gemini-native-endpoint.test.js tests/unit/combo-routing.test.js tests/unit/combo-fusion.test.js tests/unit/combo-prompt-routing.test.js tests/unit/combo-prompt-provider-translation.test.js tests/unit/combo-prompt-txt-upload.test.js tests/unit/combo-capabilities.test.js tests/unit/fusion-strip-stream-options-3024.test.js tests/unit/commandcode-executor.test.js tests/unit/codex-fast-capacity.test.js tests/unit/kiro-terminal-integrity.test.js tests/unit/kiro-usage-and-tool-integrity.test.js tests/unit/openai-responses-nonstream.test.js tests/unit/qoder-stream-errors.test.js tests/unit/key-access-controls.test.js tests/unit/playground-full-chat.test.js tests/unit/dashboard-navigation-style.test.js tests/unit/dashboard-guard.test.js tests/unit/combos-theme.test.js
```

**Safety-harness setup for Step 3 (must precede baseline):** Create `bootstrap.cjs` in the verified scratch path with `global.__appBootstrapped = true` and a socket guard rejecting non-loopback destination connects; create scratch HOME/DATA_DIR/TMPDIR/evidence directories before exports. Use a scratch Vitest setup/config wrapper to repeat bootstrap flag/network protection inside every test worker, since its globals can be isolated from the launcher. Pass `--config /root/.hermes/cache/scratch/jrouter-models-aliases/vitest.config.mjs` to baseline/final commands (wrapper imports `tests/vitest.config.js` using execution-root absolute URL, preserves aliases/exclusions and adds only safety setup). Verify the guard with an intentional non-loopback refusal and a loopback fixture; do not actually call a provider. Preload the same bootstrap flag for previews, because startup cleanup can kill host tunnels/bridges even with a separate port. Build/preview with fresh HOME/DATA_DIR, `MODEL_CATALOG_SYNC=off`, `MODEL_HEALTH_SCHEDULER=false`, `DISABLE_BACKGROUND_TOKEN_REFRESH=true`, `ENABLE_REQUEST_LOGS=false`, `NEXT_TELEMETRY_DISABLED=1`. Bind `127.0.0.1` port 20389 only after checking it is free; reserve different ports for concurrent fake upstreams. Block outbound non-loopback calls in fixtures. Create these scratch files with the file tools, not inside the repository; if they already exist read and merge first. The network guard accepts loopback TCP or scratch Unix sockets only and is a verification harness, not a production source change.

`bootstrap.cjs` (also loaded with `--require` for baseline/preview):

```js
const net = require('node:net');
const path = require('node:path');
globalThis.__appBootstrapped = true;
const marker = Symbol.for('jrouter.verification.loopbackGuard');
if (!net.Socket.prototype[marker]) {
  const connect = net.Socket.prototype.connect;
  const loopback = new Set(['localhost','127.0.0.1','::1','::ffff:127.0.0.1']);
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first : null;
    const socketPath = options?.path || (typeof first === 'string' ? first : null);
    if (socketPath) {
      if (!path.resolve(socketPath).startsWith('/root/.hermes/cache/scratch/')) throw new Error('Blocked verification socket path');
    } else {
      const host = options?.host || (typeof args[1] === 'string' ? args[1] : 'localhost');
      if (!loopback.has(host)) throw new Error(`Blocked non-loopback verification connect: ${host}`);
    }
    return connect.apply(this,args);
  };
  net.Socket.prototype[marker] = true;
}
```

`vitest.setup.mjs` imports the guard within every worker before test modules:

```js
import './bootstrap.cjs';
globalThis.__appBootstrapped = true;
if (!process.env.DATA_DIR?.startsWith('/root/.hermes/cache/scratch/')) {
  throw new Error('Verification DATA_DIR is not isolated');
}
if (!process.env.HOME?.startsWith('/root/.hermes/cache/scratch/')) {
  throw new Error('Verification HOME is not isolated');
}
```

`vitest.config.mjs` (update the execution-root import only if Task 0 selects a different directory):

```js
import config from '/root/workspace/JRouter-models-aliases/tests/vitest.config.js';
export default {
  ...config,
  test: {
    ...config.test,
    setupFiles: [...(config.test.setupFiles || []), '/root/.hermes/cache/scratch/jrouter-models-aliases/vitest.setup.mjs'],
  },
};
```

Verify `new net.Socket().connect({host:'example.invalid',port:443})` throws synchronously before DNS, and a fixture at `127.0.0.1` connects. Run this in a disposable process with the preload. All baseline/candidate commands must use the wrapper, without modifying the committed Vitest configuration. Where existing tests use `os.tmpdir()`, scratch TMPDIR keeps their fixtures out of the system temporary directory.
- [ ] **Step 5: Record verified baseline and hold all git mutations except the authorized worktree creation.** No commits are made by any later task without new authorization.

### Task 1: Alias configuration, persistence, and namespace invariants

**Files:**
- Create: `src/lib/modelsAliases/config.js`, `src/lib/modelsAliases/members.js`, `src/lib/db/helpers/modelsAliasesNamespace.js`, `src/lib/db/repos/modelsAliasesRepo.js`, `src/lib/db/migrations/004-models-aliases.js`.
- Modify: `src/lib/db/schema.js`, `src/lib/db/migrations/index.js`, `src/lib/db/index.js`, `src/lib/db/repos/combosRepo.js`, `src/models/index.js` only if exports are explicit rather than reexports.
- Test: `tests/unit/models-aliases-config.test.js`, `tests/unit/models-aliases-repo.test.js`, `tests/unit/models-aliases-migration.test.js`.

**Interfaces:**
- `validateModelsAliasName(name) -> string`; `normalizeModelsAliasConfig(input) -> validated routing/prompt fields`.
- `getConfiguredAliasOrder(alias) -> string[]`; `getModelsAliasConfigKey(alias) -> string` deterministic from routing-relevant fields, not clock precision alone.
- `resolveAliasMembers(modelIds) -> Promise<ResolvedMember[]>`: pure internal provider resolution, exact configured provider/node, LLM-compatible model, valid nested model path; reject placeholders/virtual members.
- `assertAliasComboNameAvailable(db,name,{aliasId=null,comboId=null}={})` in `src/lib/db/helpers/modelsAliasesNamespace.js`: fixed queries excluding the current entity, raises a typed 409 conflict; no provider resolution/await.
- Repo: `getModelsAliases()`, `getModelsAliasById(id)`, `getModelsAliasByName(name)`, `createModelsAlias(input)`, `updateModelsAlias(id,input)`, `deleteModelsAlias(id)`.

- [ ] **Step 1: Write config RED cases with real pure functions.**

```js
it('preserves slash-bearing names and rejects repeated namespace', () => {
  expect(validateModelsAliasName('deepseek/deepseek-v4.1-flash')).toBe('deepseek/deepseek-v4.1-flash');
  expect(() => validateModelsAliasName('jrouter/deepseek/flash')).toThrow();
  expect(() => validateModelsAliasName('deepseek//flash')).toThrow();
});
it('pins primary without mutating or duplicating members', () => {
  const alias = { models:['cmc/deepseek/flash','cbai/flash','cmc/deepseek/flash'], primaryModel:'cbai/flash' };
  expect(getConfiguredAliasOrder(alias)).toEqual(['cbai/flash','cmc/deepseek/flash']);
  expect(alias.models).toHaveLength(3);
});
```

- [ ] **Step 2: Run RED:** from execution root, `node tests/node_modules/vitest/vitest.mjs run --config /root/.hermes/cache/scratch/jrouter-models-aliases/vitest.config.mjs tests/unit/models-aliases-config.test.js`. Missing export is expected until implemented; then assert invalid deadline, primary/judge removal, empty/virtual/media/placeholder members and case preservation.
- [ ] **Step 3: Implement pure fields and asynchronous member validation.** Default `strategy:'fallback'`, `judgeModel:null`, `initialResponseTimeoutSeconds:15`; use existing prompt validation. Finite positive timeout must also convert safely to JS timer milliseconds without overflow. Reject unrepresentable timer values with a validation error, not timer clamping. Use `structuredClone`/nonmutating arrays where needed.
- [ ] **Step 4: Add additive table/migration.** Current versioned migrations end at 3 while backup schema constant is 5: new registry migration is **4**, central `SCHEMA_VERSION` becomes **6**. Store explicit columns for `name`, JSON `models`, `primaryModel`, `strategy`, `judgeModel`, REAL `initialResponseTimeoutSeconds`, existing prompt fields/timestamps. Build new table SQL through `TABLES/buildCreateTableSql`; no copying production data.

```js
import { buildCreateTableSql, TABLES } from '../schema.js';

export default {
  version: 4,
  name: 'models-aliases',
  up(db) {
    db.exec(buildCreateTableSql('modelsAliases', TABLES.modelsAliases));
  },
};
```

- [ ] **Step 5: Enforce cross-entity names inside synchronous transactions.** Resolve async members before entering a transaction; inside it reread relevant provider/node existence and names. A namespace check happens before INSERT/UPDATE on both repositories. Add SQLite insert/update guards if required to protect direct import/concurrent writers; they use fixed table names and parameterized app queries, never generated user SQL. Do not execute async callbacks in adapter transactions.

```js
const checked = normalizeModelsAliasConfig(input);
await resolveAliasMembers(checked.models);
db.transaction(() => {
  assertAliasComboNameAvailable(db, checked.name, { aliasId: id });
  db.run('UPDATE modelsAliases SET name = ?, models = ? WHERE id = ?',
    [checked.name, JSON.stringify(checked.models), id]);
});
```

Use the fixed-query helper defined in this task from both repositories. Keep configuration normalization pure. Do not import the provider resolver back into `model.js` through a DB initialization cycle.
- [ ] **Step 6: Keep DB backup/import/export coherent.** Export new entity under `modelsAliases` (plural), retain `modelAliases` legacy mapping unchanged. Import older backups without the new field as empty aliases; validate alias configuration and namespace against the incoming payload's provider nodes/connections/custom models (not the current DB) before destructive replace, reject collisions atomically, and retain original DB on invalid import. Delete incoming-replaced aliases alongside Combos before reinsert (older payload missing `modelsAliases` restores an empty set), then insert incoming provider/custom records before aliases. Test destination with a stale alias and incoming valid differently named providers, collisions in both directions, duplicate alias names and malformed member data. Add tests using isolated DB only. Never run import on live data.
- [ ] **Step 7: Run GREEN/config/repo/migration and `tests/unit/db-migration-chain.test.js`, `tests/unit/key-access-migration.test.js`, `tests/unit/combo-prompt-settings.test.js` for existing DB import/Combo regressions.** Close fixture adapters and isolate global DB state. Hand off exact exports and configuration key, then fresh spec/quality review. No commit.

### Task 2: Exact public targets and two-policy authorization

**Files:**
- Create: `src/sse/services/publicLlmTarget.js`, `src/lib/apiKeyPolicy/virtualTargets.js`.
- Modify: `src/lib/apiKeyPolicy/context.js`, `src/sse/services/keyAccess.js`.
- Test: `tests/unit/public-llm-target.test.js`, `tests/unit/virtual-target-policy.test.js`.

**Interfaces:**
- `resolvePublicLlmTarget(requested, {findAliasByName,findComboByName}={}) -> Promise<PublicLlmTarget>`.
- `virtualTargetIdentifiers(target) -> string[]`: alias only `[publicId]`, Combo `[publicId,name]`.
- `resolveConfiguredLlmLeaves(target) -> Promise<ResolvedMember[]>`: reuse pure `resolveModelInfo`; cycle guard existing nested Combos; never recurse new aliases.
- `authorizeVirtualTarget(target,{policy,keyAccess}) -> Promise<AuthorizedLlmTarget>`.
- `assertAuthorizedVirtualMember(authorized, requested, info, {extraComboMember=false}={})`: configured leaf gets parent grant but member block applies; extra Combo judge/adapter passes both policies independently.

- [ ] **Step 1: Write RED exact-lookup tests with injected repositories/parser spies.**

```js
it('resolves a whole public name before provider parsing', async () => {
  const findAliasByName = vi.fn(async name => name === 'deepseek/flash' ? alias : null);
  const target = await resolvePublicLlmTarget('jrouter/deepseek/flash', {findAliasByName,findComboByName:async()=>null});
  expect(target.publicId).toBe('jrouter/deepseek/flash');
  expect(findAliasByName).toHaveBeenCalledWith('deepseek/flash');
});
it('provider permission does not grant a virtual parent', async () => {
  await expect(authorizeVirtualTarget(target, {policy:{allowedModels:['cbai/flash'],blockedModels:[]},keyAccess:null}))
    .rejects.toMatchObject({ status:403 });
});
```

- [ ] **Step 2: Run RED:** `node tests/node_modules/vitest/vitest.mjs run --config /root/.hermes/cache/scratch/jrouter-models-aliases/vitest.config.mjs tests/unit/public-llm-target.test.js tests/unit/virtual-target-policy.test.js`.
- [ ] **Step 3: Implement exact external boundary.** Only leading `jrouter/` lookup and exact existing bare LLM Combo names succeed. Never global-reject inside internal `resolveModelInfo`, because media/health use it. Strip existing context marker once at admission and retain its routing/output-token semantics; a marker cannot create a provider bypass.

```js
export function virtualTargetIdentifiers(target) {
  return target.kind === 'combo' ? [target.publicId, target.name] : [target.publicId];
}
```

- [ ] **Step 4: Replace implicit Combo grants with server-owned leaf authorization.** Extend AsyncLocalStorage context with admitted target/authorized member set. In `assertCurrentModelAllowed`, preserve direct/non-LLM default when no virtual target; for virtual requests use configured-leaf membership and block checks. Do not append parent ID indiscriminately to every resolved model. Never let payload/query/header authorize internal execution.
- [ ] **Step 5: Test policy intersection.** Cover case-sensitive current patterns versus case-insensitive legacy matching without lowering target lookup, canonical/bare Combo equivalents, both restrictions, wildcard/member block, restricted-empty deny-all, unknown/fully blocked targets, cyclic existing Combo graph, reserved provider prefix, and extra Combo judge/adapter own permission.
- [ ] **Step 6: Run GREEN plus existing key-access/context tests.** Confirm no permission writes/migration. Review, hand off authorized descriptor. No commit.

### Task 3: Alias runtime order, rotation, cooldown, and leases

**Files:** Create `src/sse/services/modelsAliasRuntime.js`, `src/sse/services/modelsAliasFailure.js`; test `tests/unit/models-aliases-runtime.test.js`, `tests/unit/models-aliases-failure.test.js`.

**Interfaces:**
- `getAliasCandidateSnapshot(alias,{allowedMembers,now=Date.now()}) -> {aliasId,configVersion,candidates:string[]}`.
- `tryClaimAliasMember(snapshot,memberId,{now=Date.now()}={}) -> lease|null`.
- `settleAliasMemberAttempt(lease,outcome,{now=Date.now()}={})`, `releaseAliasMemberAttempt(lease)` idempotent/stale-safe.
- `getModelsAliasRuntimeStatus(alias,{now=Date.now()}={}) -> AliasRuntimeStatus`.
- `resetModelsAliasRuntimeOrder(alias)`, `invalidateModelsAliasRuntime(aliasId)`.
- `getModelsAliasConfigurationSignal(alias) -> AbortSignal`: runtime owns one controller for current routing version; config invalidation aborts it and stale leases. Order-only reset preserves this controller/cooldowns.
- Failure input is internal structured `{category,status,error,resetsAtMs,retryAfter,outputStarted,cancelReason}`; never classify only a final generic public 503.

- [ ] **Step 1: Write RED fake-clock order/recovery tests.**

```js
it('demotes non-primary while keeping one recovery trial', () => {
  const snap = getAliasCandidateSnapshot(alias,{allowedMembers:alias.models,now:0});
  const lease = tryClaimAliasMember(snap,'cbai/flash',{now:0});
  settleAliasMemberAttempt(lease,{category:'transient'},{now:0});
  const ready = getAliasCandidateSnapshot(alias,{allowedMembers:alias.models,now:30000});
  expect(tryClaimAliasMember(ready,'cbai/flash',{now:30000})).not.toBeNull();
  expect(tryClaimAliasMember(ready,'cbai/flash',{now:30000})).toBeNull();
});
```

- [ ] **Step 2: Run RED:** `node tests/node_modules/vitest/vitest.mjs run --config /root/.hermes/cache/scratch/jrouter-models-aliases/vitest.config.mjs tests/unit/models-aliases-runtime.test.js tests/unit/models-aliases-failure.test.js`.
- [ ] **Step 3: Implement global state with versioned leases.**

```js
const key = Symbol.for('jrouter.modelsAliases.runtime');
const states = globalThis[key] ||= new Map();
const TRANSIENT_MS = [30000,60000,120000,300000];
```

States key by stable entity ID; configuration key invalidates only affected alias. Hold a lease only immediately before execution, not for every candidate in a request snapshot. Snapshot order is immutable; loop attempts each member once. Normal healthy requests are not globally serialized. Recovering member allows one trial; settle exactly once with a matching version/ownership token. Invalidated stale work cannot update new state.
- [ ] **Step 4: Implement classification boundaries.** Reuse rate-reset/error helpers, distinguish client/policy/cancel/collection from actual provider failure; preserve account locks. Primary never enters demoted non-primary list. RR rotates eligible members including primary; reset order resets rank/rotation but keeps cooldown/recovery lease.
- [ ] **Step 5: Add GREEN edge tests.** Consecutive 30/60/120/300/300 failure recovery, success reset, authoritative Retry-After, auth/payment 120s, all-ineligible earliest retry, concurrent trial, cancellation, alias deletion/edit, module duplicate global slot, and restart fixture reset. Connect successful CRUD invalidation only after Task 1 lands; no DB writes in runtime. Review/no commit.

### Task 4: Clearable initial attempt context and semantic output predicate

**Files:** Create `open-sse/services/aliasAttempt.js`, `open-sse/utils/aliasOutput.js`; test `tests/unit/model-alias-deadline.test.js`, `tests/unit/model-alias-output.test.js`.

**Interfaces:**
- `createAliasAttempt({initialResponseTimeoutMs,clientSignal,collectionSignal,configSignal}) -> {signal,deadlineAt,outputStarted,markOutput(event,format),getAccountRecoveryBudget(accountKey),abort(reason),dispose()}`.
- `getAccountRecoveryBudget(accountKey)` returns one stable budget per attempt and concrete provider/connection (or credential-session key): `{claimRefresh():boolean,claimRedispatch():boolean}`; each succeeds at most once, claims before remote work and is shared by all preparation/executor/core layers. A failed/canceled operation still consumes its claim; never reset a claim for the same account in that member attempt.
- `isQualifyingModelOutput(event,format) -> boolean`; `readAliasProtocolError(event,format) -> structuredError|null`.
- `gateAliasResponse(response,{attempt,format}) -> Promise<Response>` replays buffered prelude exactly once after qualifying event; byte decoding/parser state is per stream.

- [ ] **Step 1: Write RED disarm/cancel behavior.**

```js
it('stops only the initial timer after valid output', async () => {
  vi.useFakeTimers();
  const client = new AbortController();
  const a = createAliasAttempt({initialResponseTimeoutMs:15000,clientSignal:client.signal});
  a.markOutput({choices:[{delta:{role:'assistant'}}]},'openai');
  await vi.advanceTimersByTimeAsync(1000);
  a.markOutput({choices:[{delta:{reasoning_content:'thinking'}}]},'openai');
  await vi.advanceTimersByTimeAsync(25000);
  expect(a.signal.aborted).toBe(false);
  client.abort();
  expect(a.signal.aborted).toBe(true);
  a.dispose();
});
```

- [ ] **Step 2: Run RED:** `node tests/node_modules/vitest/vitest.mjs run --config /root/.hermes/cache/scratch/jrouter-models-aliases/vitest.config.mjs tests/unit/model-alias-deadline.test.js tests/unit/model-alias-output.test.js`.
- [ ] **Step 3: Implement dedicated controller/timer and reason taxonomy.** Do not use an uncleareable `AbortSignal.timeout` for initial deadline. Start before preparation; all await boundaries check `signal.throwIfAborted()`. Client, config, and collection signals survive valid output; only the initial timer is disarmed. Use constants in existing runtime config if shared; no executor singleton flags.
- [ ] **Step 4: Implement protocol predicate/error recognition.** Nonempty OpenAI text/reasoning, proper function-call starts/deltas, Claude content-block text/thinking/tool_use, Responses output text/reasoning/function items, Gemini text/functionCall and Ollama content/tool fields qualify. Role/empty arrays/finish/usage/ID-only non-tool metadata do not. Parse error events before fabricated '[Error]' content is generated. Test arbitrary UTF-8/SSE fragmentation and EOF without output.
- [ ] **Step 5: Implement gate with reader cleanup.** Await only pre-output readiness, not complete streaming generation; replay raw/transformed buffered events once, remove inappropriate Content-Length after structural transforms, cancel reader and abort owned fetch on timeout. Cap prelude retention by bounded state rather than accumulating unlimited heartbeats. Buffered-only JSON qualifies only after valid completed output is observable.
- [ ] **Step 6: Run GREEN and test client cancellation/pre-aborted/config invalidation.** Verify timer/listener cleanup and original byte sequence. Hand off context/predicate to transport tasks. Review/no commit.

### Task 5: Cancellable preparation and shared refresh/project ownership

**Files:**
- Create: `open-sse/utils/sharedOperation.js` only for reused cancellable shared refresh/project ownership.
- Modify: `src/lib/oauth/services/xai.js` (refresh/discovery cancellation only), `open-sse/translator/concerns/image.js` (abortable DNS wait), `src/sse/services/auth.js`, `src/sse/services/tokenRefresh.js`, `src/sse/services/antigravityQuota.js`, `open-sse/services/oauthCredentialManager.js`, `open-sse/services/tokenRefresh.js`, `open-sse/services/tokenRefresh/providers.js`, `open-sse/services/tokenRefresh/dedup.js`, `open-sse/services/projectId.js`, `open-sse/utils/proxyFetch.js`, `open-sse/rtk/headroom.js`, `open-sse/translator/concerns/prefetch.js` and concrete delegates under `open-sse/services/tokenRefresh/` that own actual fetches. Executor-owned refresh overrides remain Task 6 ownership; consume its optional signal API at integration, no concurrent executor edits.
- Test: `tests/unit/model-alias-refresh-cancellation.test.js`, `tests/unit/model-alias-preparation-cancellation.test.js`.

**Interfaces:** optional trailing `{signal,recoveryBudget}` on existing refresh/project/auth APIs; `joinSharedOperation(map,key,start,{signal}) -> Promise<result>`, where `start(sharedSignal)` owns the actual operation. Existing callers without signals remain legitimate owners.

- [ ] **Step 1: Write RED refcount test with real controlled fetch stub.**

```js
it('cancels one refresh waiter without canceling another owner', async () => {
  const cache = new Map();
  const a = new AbortController(); const b = new AbortController();
  let sharedSignal; let resolve;
  const start = vi.fn(signal => {sharedSignal=signal;return new Promise(r=>{resolve=r;});});
  const pa = joinSharedOperation(cache,'account',start,{signal:a.signal}).catch(e=>e);
  const pb = joinSharedOperation(cache,'account',start,{signal:b.signal});
  a.abort();
  expect(sharedSignal.aborted).toBe(false);
  resolve({accessToken:'fixture-rotated'});
  await pa; expect(await pb).toEqual({accessToken:'fixture-rotated'});
  expect(start).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run RED:** explicit two new cancellation suites. Add last-owner abort, rejected/canceled results not cached, rotating token persisted once, non-alias/background owner retained.
- [ ] **Step 3: Thread ownership into real fetches.** Make refresh callback accept shared signal through provider handlers and executor refresh helpers. Do not bind shared refresh to the first caller's controller. Retain successful token result TTL; do not cache canceled/null operation as successful refresh. Project-ID dedup uses same principle, cancelable onboard waits, and no post-cancel generation.
- [ ] **Step 4: Make queued credential selection safe.** A canceled waiter must not release later mutex nodes before its predecessor settles; remove queue node safely or defer release. Check cancellation before writes/dispatch. Preserve existing round-robin/lock behavior for signal-less callers.
- [ ] **Step 5: Audit alternate networking.** Manual MITM-bypass HTTP sockets destroy on abort; proxy catch branches cannot retry after abort. Produce an optional fourth `proxyAwareFetch(url,options,proxyOptions,{allowNetworkReplay=true}={})` server-owned argument: alias generation calls pass false through all executor delegates. False forbids proxy-to-direct/MITM fallback and TLS retry after any ambiguous failed generation dispatch, not only AbortError; preparation/discovery retains its own explicit non-generation behavior. Existing callers default unchanged. Task 6 passes the option at actual generation fetches; Task 5 owns this networking implementation. Detach image `resolvePinnedIps` and proxy DNS waiters and prevent later socket/request dispatch after cancellation (resolver work already shared by Node may finish without a request owner). Quota/image/Headroom fetch and readers receive signal; xAI discovery/refresh also pass the shared signal to real fetch and do not cache fallback on cancellation. MiMo shared cookie handshake is Task 6 ownership, consuming the same sharedOperation contract. Classify abort as cancellation, not account error. No new worker for PXPIPE: it is skipped later only for alias execution.
- [ ] **Step 6: Run GREEN plus existing token-refresh/project/proxy/auth suites.** Use mocked remote services exclusively, verify no lingering timer/socket and no canceled caller writes generation afterward. Enumerate concrete changed delegates in handoff rather than claiming all providers audited without evidence. Review/no commit.

### Task 6: Alias-only executor retry policy and CodeBuddy prompt retention

**Files:**
- Modify: `open-sse/shared/mimoAccount.js` for cancellable shared cookie handshake and Task 5 sharedOperation integration; `open-sse/executors/index.js` for descriptive observability metadata; `open-sse/executors/base.js`, `default.js`, `commandcode.js`, `codebuddy-intl.js`, `codex.js`, `kiro.js`, `github.js`, `xiaomi-mimo.js`, `mimo-free.js`; inspect other executor overrides and edit only ones with alias-relevant redispatch/cancellation paths.
- Test: `tests/unit/model-alias-executor-policy.test.js`, `tests/unit/model-alias-provider-prompt.test.js`.

**Interfaces:** trailing server-owned `executionOptions = null` per call with `{alias:true,attempt,recoveryBudget,allowNetworkReplay:false,retryPolicy:'single-attempt',forceUpstreamStreaming:true,preserveAliasInstructions:true}`; clients cannot populate it. `transformRequest(model,body,stream,credentials,executionOptions=null)` and refresh `{signal,recoveryBudget}`. Default option absence preserves legacy behavior.

- [ ] **Step 1: Write RED dispatch-count tests calling real executors and mocking only `proxyAwareFetch`.**

```js
it('does not repeat a 503 generation for an alias', async () => {
  proxyAwareFetch.mockResolvedValue(new Response('{}',{status:503}));
  await executor.execute({model:'fixture',body:{messages:[]},credentials:{},stream:true,
    executionOptions:{retryPolicy:'single-attempt'}});
  expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run RED:** both new suites; prove ordinary executor still repeats according to existing registry config. Do not replace `executor.execute` with a handwritten test implementation. Test rejected proxy/native generation fetches, TLS failure and MITM bypass failure for exactly one dispatch, not only a resolved HTTP 503; signal-less ordinary requests retain networking fallback.
- [ ] **Step 3: Honor policy in all extra retry layers.** Disable Base status/network sleeps and repeated alternative endpoint attempts after real transient errors; CommandCode SSE early-error retries, Codex overload retry, and Kiro integrity regeneration are also disabled for aliases. Retain strict payload/integrity checks and explicit endpoint negotiation/one credential recovery before output within Task 4's deadline. All refresh/bootstrap-recovery paths consume Task 4's shared account budget, including MiMo cookie/JWT and chatCore recovery; thread signal into the actual shared cookie handshake, detach one canceled waiter while keeping other legitimate owners, abort last-owner fetch/redirect chain and never cache cancellation.
- [ ] **Step 4: Retain actual readiness behind buffered executor gates.** Kiro decoded valid semantic deltas notify attempt before integrity EOF, but a late failed integrity check is terminal. Other buffered executors report their actual incremental visibility if supported or buffered-only metadata if not. Produce `getExecutorOutputObservability(provider) -> 'incremental'|'buffered'` from verified executor paths in `open-sse/executors/index.js`; expose descriptive provider metadata in authenticated `/api/models-aliases` GET for registered providers/nodes and their canonical IDs/prefixes, consumed by Task 14 even for a new unsaved member (no credentials, live catalog fetch or new public provider catalog). Never infer readiness from synthetic role/finish text.
- [ ] **Step 5: Preserve CodeBuddy per call.**

```js
const instructions = source.filter(m => m?.role === 'system' || m?.role === 'developer');
transformed.messages = [{role:'system',content:'You are CodeBuddy Code.'}];
if (executionOptions?.preserveAliasInstructions) transformed.messages.push(...structuredClone(instructions));
```

Retain provider-required leading system and typed user content, composed instruction order and opt-in reasoning/tools. Do not store flags on singleton executor or read `_alias` from payload. Exercise outgoing fetch JSON for prepend/append/replace, disabled injection with client instructions, concurrent ordinary request, panel/judge, account retry and unchanged original body.
- [ ] **Step 6: Run GREEN with concrete existing executor tests.** Inspect fail signatures against baseline. Review/no commit.

### Task 7: Observe valid output in streaming and non-streaming collectors

**Files:**
- Modify: `open-sse/handlers/chatCore.js`, `open-sse/handlers/chatCore/streamingHandler.js`, `sseToJsonHandler.js`, `nonStreamingHandler.js`, `open-sse/utils/stream.js`, `streamHandler.js`, `open-sse/transformer/streamToJsonConverter.js`.
- Modify narrowly: `open-sse/translator/response/openai-responses.js`, `claude-to-openai.js`, and concrete executor stream error emitters only where pre-output errors are otherwise transformed into successful text.
- Test: `tests/unit/model-alias-response-gate.test.js`, extend `tests/unit/model-alias-deadline.test.js`.

**Interfaces:** `handleChatCore({...existing,signal,executionOptions=null})`; optional observer options on existing translators/collectors, `onValidOutput(event,format)` calls Task 4 attempt. Result carries internal `outputStarted` and structured failure metadata, never sent as a trusted client input.

- [ ] **Step 1: Write RED for HTTP-ok/no-semantic-output and late error.**

```js
it('does not commit an empty successful SSE response', async () => {
  const {stream,enqueue} = controlledSse();
  const pending = gateAliasResponse(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),{attempt,format:'openai'});
  enqueue(': ping\n\n'); enqueue('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
  expect(await isPending(pending)).toBe(true);
  enqueue('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n');
  const response = await pending;
  expect(response.ok).toBe(true);
});
```

`controlledSse` and `isPending` are local test helpers (define them in the test file; no test framework dependency). `isPending` checks a settled flag after flushing microtasks, not a sleep.
- [ ] **Step 2: Run RED:** response-gate and deadline suites; fake timers and reader cancel spies verify abort at exactly member deadline.
- [ ] **Step 3: Connect observer at translation boundary.** Make valid output callbacks optional; do not alter global `hasValuableContent` predicate for ordinary streams. Preserve real structured errors so alias readiness cannot mistake `[Error]` synthesis for content.
- [ ] **Step 4: Incremental JSON collection in alias mode.** Replace `response.text()` only on alias SSE aggregation with incremental reader/event observation; extend Responses accumulator with optional signal/event hook. A valid-output latch remains true even if final JSON parsing/provider EOF fails; account/member orchestration must not fallback then. True buffered JSON gets completed-answer deadline semantics approved in spec.
- [ ] **Step 5: Pass one signal through preparation/core/redispatch.** Reactive refresh consumes the same account budget as proactive/executor refresh, rather than applying another independent one-refresh limit, and the same external attempt signal; deep-clone source/translated bodies for redispatch. PXPIPE is skipped when execution options mark alias; settings remain untouched. No hidden post-cancel remote image/project/refresh task dispatch.
- [ ] **Step 6: GREEN protocol matrix.** Text/reasoning/tool output, role/heartbeat/finish false readiness, Kiro integrity buffered readiness, arbitrary bytes/UTF-8, native OpenAI/Responses/Claude/Gemini, JSON over forced SSE, late error terminal, long >15s completion, and client cancellation. Existing stream/stall/nonstreaming/translation tests retain default behavior. Review/no commit.

### Task 8: Shared provider callback and Models Alias strategy orchestration

**Files:**
- Create: `src/sse/handlers/providerChat.js`, `src/sse/services/modelsAliasChat.js`.
- Modify: `src/sse/handlers/chat.js` only to extract private provider function without public behavior switch yet; `open-sse/services/combo.js` for narrowly optional alias callbacks.
- Test: `tests/unit/model-alias-routing.test.js`, `tests/unit/model-alias-fusion.test.js`, `tests/unit/model-alias-prompt-routing.test.js`.

**Interfaces:**
- `executeProviderChat({body,member,request,clientRawRequest,apiKey,executionOptions}) -> Promise<{response,outputStarted,failure,usage}>`: server-only, requires admitted member or management authorization outside the callback. Retains provider/account/format behavior of current private handler.
- `handleModelsAliasChat({authorized,body,request,clientRawRequest,apiKey,log}) -> Promise<Response>`.
- `handleComboChat({...existing,executionOptions=null})` optional candidate/settlement/prepared execution; `handleFusionChat({...existing,executionOptions=null})` optional alias panel collector/judge/serialization callbacks. Absent options keeps ordinary strategy behavior.

- [ ] **Step 1: Write RED candidate trace with actual orchestration.**

```js
it('tries primary then other members once and changes only runtime order', async () => {
  const calls=[];
  const executeMember=vi.fn(async id => {calls.push(id);return id==='b/model' ? okAnswer : earlyTransientFailure;});
  await runAliasFixture({alias,executeMember});
  expect(calls).toEqual(['primary/model','a/model','b/model']);
  expect(alias.models).toEqual(['primary/model','a/model','b/model','c/model']);
  expect(getModelsAliasRuntimeStatus(alias).effectiveOrder).toEqual(['primary/model','b/model','c/model','a/model']);
});
```

`runAliasFixture` is a local helper composing the real orchestrator, authorized descriptor, fake request and mock provider callback; it is not a second strategy implementation.
- [ ] **Step 2: Run RED routing/fusion/prompt tests.** Add 6s preparation on account1 + 9s account2 exact deadline, no penalty for client/config/collection abort, initial-deadline expiry classified as transient upstream non-readiness, and late-output no failover at all levels.
- [ ] **Step 3: Extract existing private provider work with minimal behavior change.** Legacy nested Combo handling remains in `chat.js`; provider callback operates only resolved provider member. Original callbacks without execution options stay unchanged. Obtain `attempt.getAccountRecoveryBudget(provider + ':' + connectionId)` before preparation and pass it unchanged to refresh/core/executor; no-auth/session executors use a stable session key and do not manufacture a fresh budget on every retry. Alias account loop shares Task 4 attempt and refuses replay after `outputStarted`, even if result indicates error.
- [ ] **Step 4: Compose once and execute isolated bodies.** Use `applyComboPromptInjection` with alias config/name and canonical requested ID, preserving existing variable names in reused helper. `structuredClone` composed body per member/account and before refresh redispatch. No duplicated prompt or bypass path.
- [ ] **Step 5: Extend strategies with state callbacks, not a duplicate provider engine.** Alias fallback/RR candidate snapshot + lease settlement uses Tasks 3/4. Filter strictly to authorized configured members; capacity fit can reorder eligible non-primary choices only in a way that does not discard hard input. A primary lacking required modality must not receive stripped data merely to honor rank; return clear unsupported error or select another eligible configured capable member using existing safety checks.
- [ ] **Step 6: Fusion collection settles usable answers inside bounds.** Count parsed useful answers, not HTTP200. Cancel outstanding controllers/readers on grace/hard/client abort without demotion. Retain successful panel JSON; serialize one stored answer through existing protocol serializers rather than new generation/usage write. Primary/explicit judge then other eligible configured members, no repeat and no post-output fallback. Flatten tools in OpenAI, Responses and Gemini panel histories; judge retains original composed history/tools.

```js
// Within handleFusionChat:
async function reuseSingleAliasAnswer(answers, executionOptions) {
  if (answers.length === 1 && executionOptions?.alias) {
    return executionOptions.serializeStoredAnswer(answers[0]);
  }
  return null;
}
```

Implement/define `serializeStoredAnswer` using existing response translators/stream formatting; Task 11 public-identity adapter is downstream. Test callback fetch count, usage attribution and protocol terminal fields.
- [ ] **Step 7: GREEN with existing Combo fusion/round-robin/prompt/capability tests.** Alias-specific failure metadata differentiates actual provider status/reset from generic exhausted-account error. Review/no commit.

### Task 9: Public LLM admission and all existing protocol entry points

**Files:**
- Modify: `open-sse/translator/request/gemini-to-openai.js` only if an alias-required supported part would otherwise be discarded (preserve defaults outside alias use); `src/lib/apiKeyPolicy/gateway.js`, `src/sse/handlers/chat.js`, `src/app/api/v1/messages/count_tokens/route.js`, `src/app/api/v1/responses/compact/route.js`, `src/app/api/v1beta/models/[...path]/route.js`, `src/app/api/v1/api/chat/route.js`, `open-sse/utils/ollamaTransform.js`, `src/app/api/models/test/ping.js`, `src/app/api/models/test/route.js` only to preserve authorized management testing.
- Test: `tests/unit/public-llm-admission.test.js`, `tests/unit/public-llm-entrypoints.test.js`, `tests/unit/model-alias-management-probe.test.js`.

**Interfaces:** `withApiKeyPolicy(request,handler,{...existing,targetAdmission:null|'public-llm'})`; external LLM wrapper establishes authorized virtual target before pricing/quota/provider lookup. Optional/no-key mode still resolves/admit target. Nested wrapper must match current admitted ID and inherit server-owned context, not skip admission for arbitrary target.

- [ ] **Step 1: Write RED real-route matrix before production edits.**

```js
it.each(['cbai/flash','codebuddy-intl/flash','legacy-provider-alias'])('rejects direct %s before dispatch', async model => {
  const response=await POST(chatRequest({model,messages:[{role:'user',content:'fixture'}]}));
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe('direct_model_not_allowed');
  expect(executeProviderChat).not.toHaveBeenCalled();
  expect(reserveKeyUsage).not.toHaveBeenCalled();
});
```

Mock actual DB/auth/core boundaries but call real gateway/route exports. Include forged `_internal`, arbitrary headers, local no-key/CLI, provider allow-only key, unknown jrouter target and lowercase mismatch.
- [ ] **Step 2: Run RED admission/entrypoint suites.** Routes set in table below, no invented endpoints:

```text
/api/v1/chat/completions
/api/v1/messages
/api/v1/responses
/api/v1/responses/compact
/api/v1/messages/count_tokens
/api/v1beta/models/jrouter/deepseek/flash:generateContent
/api/v1beta/models/jrouter/deepseek/flash:streamGenerateContent
/api/v1/api/chat
```

- [ ] **Step 3: Gate after auth/endpoint checks, before bypass, provider resolution/pricing or reservation.** Bare/prefixed Combo dispatch uses configured bare name for settings/rotation/prompt but canonical public response ID. Invalid requests cannot consume inference quota or choose credentials. Price virtual requests using authorized member prices; retain fusion actual usage accounting and no inaccurate single-provider price promises.
- [ ] **Step 4: Preserve signals/paths across adapters.** Compact and Gemini reconstructed Requests include `signal:request.signal`; Gemini parses joined path once and splits final action suffix, not first two segments. Preserve native audio/TTS branch. Token count is nonbillable but still requires virtual target and both policies. Ollama must return unsuccessful response unchanged, not turn 403 into successful empty NDJSON. Alias Gemini request conversion uses existing `geminiToOpenAIRequest` from `open-sse/translator/request/gemini-to-openai.js`, preserving typed media, tools and function history before Task 8 capability detection; keep ordinary Combo/native media conversion behavior unchanged. Unsupported Gemini parts must fail explicitly rather than disappear. Exercise actual alias route with inline media, tool declarations, functionCall/functionResponse history and final tool output. For alias Gemini/Ollama streaming adapters, retain partial UTF-8/SSE frames and translate terminal `error` payloads after a valid delta: Gemini emits an error event/body then closes, Ollama emits an `error` NDJSON record and never a success `done` record afterward; no second generation. Final Gemini adapter must preserve tool calls too and use the admitted canonical publicId (including bare Combo invocation) for modelVersion regardless of usage fields; never use the original bare/provider target as a fallback. Test fragmented actual route responses, not only the inner handleChat identity adapter; non-alias adapter changes are limited to the explicitly approved pre-output error pass-through.
- [ ] **Step 5: Management model tests call private server callback only after dashboard authorization.** Do not use a CLI header to bypass public admission. Existing management/provider probes remain valid; health catalog keeps raw provider builder. Test authorized fixture callback and forbidden inference-key access; no real provider call.
- [ ] **Step 6: GREEN both policy restrictions, independent Combo adapter/judge permission, bare Combo compatibility, media regressions.** Do not create an automatic permission/model migration. Review/no commit.

### Task 10: Shared virtual public catalog and discovery adapters

**Files:**
- Create: `src/sse/services/publicLlmCatalog.js`, `src/app/api/models/public/route.js`.
- Modify: `src/app/api/v1/models/route.js`, `[...model]/route.js`, `info/route.js`, `src/app/api/v1beta/models/route.js`, `src/app/api/tags/route.js`, `src/lib/apiKeyPolicy/catalog.js`.
- Test: `tests/unit/public-llm-discovery.test.js`, `tests/unit/models-aliases-capabilities.test.js`.

**Interfaces:** `buildPublicLlmModelsList({policy=null,keyAccess=null,dashboard=false}={}) -> Promise<PublicCatalogEntry[]>`; `getVirtualTargetCapabilities(target) -> metadata` uses configured resolved member limits, not current cooldown. Dashboard builder supplies all manageable virtual targets independent of selected inference key. Existing `buildModelsList(kindFilter,options)` retains raw provider semantics for health/media.

- [ ] **Step 1: Write RED exact catalog and cooldown stability.**

```js
it('lists only canonical virtual LLM IDs and keeps them during cooldown', async () => {
  const ids=(await buildPublicLlmModelsList()).map(m=>m.id);
  expect(ids).toEqual(['jrouter/deepseek/flash','jrouter/LegacyCombo']);
  expect(ids.some(id=>id.startsWith('cbai/'))).toBe(false);
  expect(await catalogIdsAfterCooldown()).toEqual(ids);
});
```

Define fixture helper `catalogIdsAfterCooldown` with real runtime settlement; stub no upstream live resolvers.
- [ ] **Step 2: Run RED discovery/capabilities suites.** Matrix list/root /v1, canonical nested lookup, info query, Gemini `models/jrouter/...`, Ollama tags. Keep tags existing dashboard/CLI auth contract; do not add new public exception.
- [ ] **Step 3: Implement shared builder.** Enumerate aliases and LLM Combos, authorize parent + configured leaves through Task 2, omit invalid/no-authorized-member targets, dedupe IDs. Ignore legacy single-provider mapping records as public entries. Cooldown not a catalog filter. Compute minimum context/output across valid configured members, do not inflate from blocked/cooling primary; capabilities use actual provider resolution, not name guessing. For new aliases guarantee advertised hard modality only when configured routing can serve it without stripping data; keep Combo aggregate behavior unchanged except approved canonical public envelope/top-level limits.
- [ ] **Step 4: Update only LLM branches.** `/v1/models/image-to-text` is chat-invoked LLM discovery, so use virtual capability filtering; media catalogs image/tts/stt/embedding/web/video retain raw builder. Model info must apply both policies. Preserve encoded nested path and case. Gemini catalogs preserve native media entries but never duplicate bare LLM provider IDs.
- [ ] **Step 5: Dashboard route requires `canManageApiKeys` and existing guard path; returns `{models}` safe metadata.** Do not expose secrets/provider tokens; don't filter list by the currently edited key. Alias member management continues separate provider metadata.
- [ ] **Step 6: GREEN existing health/media/key discovery fixtures plus new surfaces.** Move old direct-provider public assertions to internal-builder coverage rather than deleting intended behavior tests. Review/no commit.

### Task 11: Canonical response identity without changing upstream accounting

**Files:** Create `src/sse/services/publicLlmResponse.js`; test `tests/unit/public-llm-response.test.js`. Modify `open-sse/utils/ollamaTransform.js` only under coordinated Task 9 ownership when integrating.

**Interfaces:** `rewritePublicModelFields(payload,publicId,format) -> payload`; `adaptPublicLlmResponse(response,{publicId,format}) -> Promise<Response>`.

- [ ] **Step 1: Write RED protocol allowlist.**

```js
it('changes only protocol model fields', () => {
  const payload={model:'cbai/flash',choices:[{message:{content:'cbai/flash',tool_calls:[{id:'cbai/flash'}]}}]};
  const result=rewritePublicModelFields(payload,'jrouter/deepseek/flash','openai');
  expect(result.model).toBe('jrouter/deepseek/flash');
  expect(result.choices).toEqual(payload.choices);
});
```

- [ ] **Step 2: Run RED:** public response suite, fixture schema matrix Chat top-level/chunk `model`, Claude message/message_start model, Responses envelope/event `.response.model`, Gemini `.modelVersion` or known wrapped field, Ollama terminal records.
- [ ] **Step 3: Implement structural response adapter.** Preserve successful status/headers except invalid content-length, errors/cancellation and protocol framing; do not recursively replace arbitrary `model` keys in tool/user content. Incrementally decode split UTF-8 and multiline SSE/NDJSON, flush final frame and `[DONE]` once.
- [ ] **Step 4: Wire only after internal upstream translation/accounting.** Task 9 integrates at external `handleChat` return under its exclusive `chat.js` ownership; invocation bypass/warmup response must also use canonical identity. Task 11 creates/tests only the adapter before that integration. Client public identity never becomes upstream `modelInfo.model`. Preserve bare Combo canonical output.
- [ ] **Step 5: GREEN fragment at every byte boundary and cancel upstream reader.** Usage/provider/model/connection remain actual; panel answer reuse does not duplicate accounting. Review/no commit.

### Task 12: Dashboard CRUD, safe runtime status, and reset APIs

**Files:**
- Create: `src/app/api/models-aliases/route.js`, `[id]/route.js`, `[id]/runtime/route.js`, `[id]/runtime/reset/route.js`.
- Modify: `src/lib/db/index.js` import post-commit invalidation hook after Task 3 exists (Task 1 finished owning this file); `src/dashboardGuard.js` to protect Models Aliases route prefix; `src/app/api/combos/route.js`/`[id]/route.js` surface collision validation errors without unrelated behavior edits.
- Test: `tests/unit/models-aliases-api.test.js`, `tests/unit/models-aliases-runtime-api.test.js`.

**Interfaces:** list `{aliases, providerMetadata: {[providerIdOrPrefix]: {outputObservability}}}` (metadata generated by Task 6; includes configured providers/nodes so newly selected members can warn before saving); CRUD returns saved alias; runtime safe DTO from Task 3; reset accepts expected `configVersion`, returns current runtime. Existing `canManageApiKeys` authorizes dashboard administration; model inference key alone never authorizes these APIs.

- [ ] **Step 1: Write RED auth/reset tests.**

```js
it('does not let a bearer inference key reset alias runtime', async () => {
  canManageApiKeys.mockResolvedValue(false);
  const response=await POST(new Request('http://fixture/api/models-aliases/a/runtime/reset',{method:'POST',headers:{Authorization:'Bearer fixture'}}),{params:Promise.resolve({id:'a'})});
  expect(response.status).toBe(401);
  expect(resetModelsAliasRuntimeOrder).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run RED:** both API suites; GET no secrets, unknown ID 404, invalid configuration 400, collision 409, stale version 409, malformed JSON 400, correct status/reset shape.
- [ ] **Step 3: Implement route handlers with existing auth envelope conventions.** Do not return full raw DB/credential data in errors. Persist through Task 1, invalidate runtime after successful change/delete. Integrate `importDb` post-transaction invalidation: capture prior alias IDs/config keys, then invalidate removed/replaced IDs after successful commit only; failed import leaves leases/signals untouched. Do this in the DB API, not only the dashboard route, so all legitimate import callers are covered. Test active lease/config signal across successful replacement, old backup removing aliases, unchanged config, and rolled-back invalid import. Alias validation resolves saved members; provider/model missing after creation yields unavailable/invalid state rather than ghost selection.
- [ ] **Step 4: Reset runtime order only.** No config PUT, provider availability mutation, cooldown clear, or probe. GET status is read-only and doesn't claim recovery lease. `serverNow`/version helps UI reject stale results; expected version validation prevents stale reset after edit.
- [ ] **Step 5: GREEN dashboard guard/Combo APIs; test direct HTTP auth separation in later smoke.** Review/no commit.

### Task 13: Context-aware shared pickers

**Files:**
- Create: `src/shared/utils/modelCatalogContext.js`.
- Modify: `src/shared/hooks/useModelCatalog.js`, `src/shared/components/ModelPickerList.js`, `src/shared/components/ModelSelectModal.js`, `src/shared/hooks/useModelCaps.js` for an optional `enabled` fetch gate (default true) and no heuristic fallback for virtual IDs.
- Test: `tests/unit/model-catalog-context.test.js`, extend `tests/unit/model-catalog-compatible-nodes.test.js`.

**Interfaces:**
- `catalogContext: 'invocation'|'members'|'key-allow'|'key-block'|'media'`; default invocation for LLM modal calls; explicit media when non-LLM kindFilter.
- Optional `includeLegacyCombos=false` for existing Combo management, `excludePlaceholders=false` (true for new alias members).
- Hook returns existing groups/filter/search plus `filteredAliases`, context-specific Combo `.value`, `loading`, `error`, `reload`.
- `ModelPickerList({aliases=[],combos=[],groups={},loading=false,error='',onRetry,...existing})` uses server caps for virtual entries.

- [ ] **Step 1: Write RED matrix.**

```js
it.each(['invocation','key-allow'])('%s LLM branch contains no provider groups', context => {
  const catalog=buildContextFixture(context);
  expect(Object.keys(catalog.groups)).toEqual([]);
  expect(catalog.aliases[0].value).toBe('jrouter/deepseek/flash');
});
it('key-block keeps member-level blocks expressible', () => {
  const catalog=buildContextFixture('key-block');
  expect(catalog.groups.cbai.models[0].value).toBe('cbai/flash');
});
```

`buildContextFixture` invokes pure normalizer/filter helpers with fixed public/provider fixtures, not reimplemented picker logic. Existing hook tests verify catalog owner behavior.
- [ ] **Step 2: Run RED new/compatible-node tests.** Deleted node, configured custom model, nested provider model ID, media Combo/model, legacy mapping, placeholder, disabled model, cooldown virtual entry.
- [ ] **Step 3: Gate data fetches by context with unconditional hook ordering.** Public picker fetches dashboard `/api/models/public`, not live account provider catalogs. Call `useModelCaps({enabled:needsProviderCatalog})` unconditionally to preserve hook order while disabling `/api/models` fetch/listeners for pure invocation; use public entry caps directly. Management/media retain existing live provider fetch paths and orphan-node guard. Failed public fetch produces error/retry, never a provider fallback. Keep selected values through failures/refresh.
- [ ] **Step 4: Add alias group/canonical Combo values in existing list.** Use `entry.value||entry.id` to select public entries, display configured names; external LLM invocation/key LLM selections use canonical `jrouter/<combo>` values, but `members/includeLegacyCombos` keeps bare configured names for existing nested Combo routing and media keeps its original values. New alias members never offer virtual targets. Add picker-select/save/reload/nested-Combo execution regression so `jrouter/Inner` is never inadvertently persisted as an internal legacy member; metadata `isAlias/isCombo/targetType` carries correctly. Public `capFilter` evaluates virtual caps rather than hides all virtual targets. Key-allow/key-block here refer to the LLM branch; the explicit key Media branch uses media context, rather than losing selectable non-LLM targets. No name-heuristic `useModelCaps` for `jrouter/...`.
- [ ] **Step 5: Annotate management consumers under Task 15 ownership.** Task 13 doesn't bulk edit CLI or Combo page concurrently. Review/no commit.

### Task 14: Models Aliases page/form/runtime UI

**Files:**
- Create: `src/app/(dashboard)/dashboard/models-aliases/page.js`, `models-aliases.module.css`, `components/ModelAliasRow.js`, `ModelAliasFormModal.js`, `ModelAliasMembers.js`, `ModelAliasRuntimeStatus.js`, `modelAliasForm.js`.
- Modify: `src/shared/components/Sidebar.js`, `Header.js`, `layouts/DashboardLayout.js` for one route/nav entry, no shell redesign.
- Reuse: existing semantic controls, existing controlled prompt helper behavior; extract `PromptInjectionFields.js` from Combo settings only if actually reused without container/save logic changes.
- Test: `tests/unit/models-aliases-form.test.js`, `models-aliases-ui.test.js`, `models-aliases-runtime-ui.test.js`.

**Interfaces:** form fields use Task 1 names and `getConfiguredAliasOrder(draft)`; produce `validateAliasDraft(draft) -> {valid:boolean,errors:Object}` in `components/modelAliasForm.js` using shared config rules; runtime status Task 3 DTO; CRUD Task 12 shapes; picker `members/excludePlaceholders`. No new modal framework/assets.

- [ ] **Step 1: Write RED pure form validation and order.**

```js
it('requires deliberate primary replacement after removal', () => {
  const draft={name:'deepseek/flash',models:['cmc/deepseek/flash'],primaryModel:'cbai/flash',strategy:'fallback',judgeModel:null,initialResponseTimeoutSeconds:15};
  expect(validateAliasDraft(draft).errors.primaryModel).toBeTruthy();
});
```

- [ ] **Step 2: Run RED form/UI tests.** Unit tests pure helpers, actual component markup transform consistent with repo where useful; source tests are contracts, not proof of focus/scroll.
- [ ] **Step 3: Implement one Save boundary.** New name/public preview, members, primary native Select, strategy/judge default-primary sentinel, positive decimal deadline, buffered-only warning, prompt modes/upload/editor/displayIdentity. Remove invalid primary/judge creates invalid draft until explicit replacement. Keep original draft on API/read/upload failure. File upload uses `file.text`, strips BOM and resets file input for repeat upload; does not send file to server.

```js
const publicId = draft.name ? `jrouter/${draft.name}` : '';
const ordered = getConfiguredAliasOrder(draft);
const canSave = validation.valid && !saving;
```

- [ ] **Step 4: Avoid stacked broken focus traps.** Prefer inline member-picker area inside the edit modal rather than changing shared Modal portal globally. Modal uses existing `trapFocus`; Escape closes current form/picker predictably, focus returns. Reorder buttons keyboard-operable; drag only if existing accessible DnD adds concrete value.
- [ ] **Step 5: Page rows/status/reset.** Use Combo density/shared controls, public ID Copy, primary/strategy/timeout/prompt indication; runtime expansion distinguishes configured/effective order while primary remains visual top. Read status only while expanded/visible, clean timer/request listeners, stale-version suppression after edit/delete. Reset does not call clearCooldown/config PUT/inference. Status errors visible.
- [ ] **Step 6: GREEN/browser matrix.** 390/768/1440 widths, light/dark, long IDs, empty/loading/error, create/edit/delete fixture, member/primary/judge removal, all strategies, deadline validation/warning, upload/read failure, countdown/recovery/reset failure, focus/Tab/Escape/reorder and no overflow. Record each interaction without applying host CLI configs or contacting upstream. Review/no commit.

### Task 15: Invocation, key-policy, Combo management, and media consumers

**Files:**
- Modify: Playground `PlaygroundPageClient.js`, `ModelPickerPopover.js`; Endpoint `ApiKeySettingsSections.js`, `ConfigureApiKeyDialog.js`, dormant `KeyAccessControls.js` only for catalog compatibility.
- Modify explicit management calls: `dashboard/combos/page.js`, `src/shared/components/ComboFormModal.js`, `dashboard/media-providers/combo/[id]/page.js`.
- Modify CLI invocation files under `src/app/(dashboard)/dashboard/cli-tools/components/`: `AntigravityToolCard.js`, `ClaudeToolCard.js`, `ClineToolCard.js`, `CodexToolCard.js`, `CopilotToolCard.js`, `CoworkToolCard.js`, `DeepSeekTuiToolCard.js`, `DefaultToolCard.js`, `DroidToolCard.js`, `GenericCliToolCard.js`, `GrokBuildToolCard.js`, `HermesToolCard.js`, `JcodeToolCard.js`, `KiloToolCard.js`, `MitmToolCard.js`, `OpenClawToolCard.js`, `OpenCodeToolCard.js`.
- Modify narrow availability seams: `src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js`, `src/app/(dashboard)/dashboard/mitm/MitmPageClient.js`, `src/shared/constants/cliTools.js`; `src/app/(dashboard)/dashboard/basic-chat/BasicChatPageClient.js` only for virtual selection/current public endpoint, preserving existing history and storage without automatic model migration.
- Test: `tests/unit/llm-picker-surface-context.test.js`, `tests/unit/cli-public-targets.test.js`, retain `tests/unit/playground-full-chat.test.js`, `key-access-controls.test.js`.

**Interfaces:** same shared picker with explicit context; no per-consumer catalog replication. Key restriction controls provide explicit LLM/Media branches: LLM Allowed lists virtual targets and LLM Blocked adds member providers; Media uses existing `media` context and unchanged identities for both Allowed/Blocked. Switching branches preserves selections from both. A newly created key can still choose non-LLM Combo/model/provider-as-model permissions, not just retain old badges. Playground page owns one hook result and passes `catalog` to popover. Keys LLM `Allowed` uses all manageable virtual LLM targets; LLM `Blocked` adds provider members; Media branch remains selectable for newly created/edited keys.

- [ ] **Step 1: Write RED exact consumer inventory.** Count actual modal sites programmatically, expect 20 CLI sites across 17 files at baseline; maintain a JSON/array manifest of file/context instead of mental counting. Tests fail if any external LLM selector still invokes management provider catalog. Do not assume count is unchanged after legitimate consolidation; compare exact site ownership.
- [ ] **Step 2: Run RED surface/CLI tests.** Add canonical outgoing selection, Cowork newly created Combo `jrouter/<name>`, Add All virtual targets, nested OpenClaw namespace retaining full API ID, and existing stored provider selection remains visible/removable without automatic migration.
- [ ] **Step 3: Integrate contexts.** Invocation default for 20 CLI sites; Combo member/judge/adapter explicitly `members` and nested Combo compatibility where currently supported; media explicitly `media`; new alias provider-only. Allowed/Blocked separation, explicit Media branch and dormant control preserve legacy restriction functionality. Add new-key tests selecting an image/tts/embedding Combo/model and provider-as-model Web target, saving/reopening without prefix or policy changes.
- [ ] **Step 4: Correct availability gates not only dropdown options.** ToolDetailClient, Generic Add All, DefaultToolCard and Mitm page availability use shared public virtual targets. Do not seed raw provider defaults for new client configuration; use an honest `jrouter/alias-name` example. Existing stored CLI settings are not overwritten.
- [ ] **Step 5: Remove duplicate Playground hook only at concrete owner seam.** Page-owned catalog supplies popover; hints/count reflect virtual target availability. Preserve transcript/draft selection as full string and fix string selection PropTypes. No chat layout redesign.
- [ ] **Step 6: GREEN/browser checks representative single/multi/default/role/subagent/profile/blocked/member/media controls.** Opening public pickers generates no account-catalog requests. Do not click host Apply to prove rendering. Any Basic Chat fix is limited to virtual selection and existing public endpoint; do not invent a backend bypass or unrelated redesign. Review/no commit.

### Task 16: Integrated offline acceptance, standalone preview, independent review

**Files:** Create `tests/unit/models-aliases-integration.test.js` and a reusable scratch verifier plus evidence JSON. Parent owns necessary revisions to the exact existing offline manifest files below after relevant implementation tasks finish; no child may edit existing regression files outside its assigned allowlist. Revise only approved public target assertions/fixtures, retain direct-provider coverage via private management/core/internal-builder paths and do not suppress unrelated failures. Update `docs/api-key-configuration.md` and `docs/FRONTEND.md` only for delivered behavior/migration notice. No release script cutover is run.

**Interfaces:** all actual task contracts; evidence tied to execution source/diff/build ID and exact fixture routes, not just an agent claim.

- [ ] **Step 1: Write RED real-wrapper integration.** Seed only synthetic providers/aliases/Combos/keys in scratch SQLite; fake upstream captures actual dispatch/abort/prompt/count. Assertions cover LLM rejection before contact, two policy systems, extra Combo judge own permission, deadline/cooldown/concurrency, canonical identities, conservative discovery, prompt CodeBuddy, fusion single-answer count/usage, and media unchanged.
- [ ] **Step 2: Run RED/GREEN new explicit suites:** all new tests named in Tasks 1-15. No broad run that discovers real tests.
- [ ] **Step 3: Run existing offline regression set, compare identities with Task 0 evidence.** Start with the following exact files after verifying presence:

```text
tests/unit/key-access.test.js
tests/unit/key-access-handlers.test.js
tests/unit/db-migration-chain.test.js
tests/unit/key-access-migration.test.js
tests/unit/combo-prompt-settings.test.js
tests/unit/api-key-policy-gateway.test.js
tests/unit/api-key-policy.test.js
tests/unit/model-catalog-compatible-nodes.test.js
tests/unit/model-catalog-scope.test.js
tests/unit/model-health-discovery.test.js
tests/unit/v1-model-lookup-3588.test.js
tests/unit/v1-models-combo-context.test.js
tests/unit/v1-models-available.test.js
tests/unit/gemini-native-endpoint.test.js
tests/unit/combo-routing.test.js
tests/unit/combo-fusion.test.js
tests/unit/combo-prompt-routing.test.js
tests/unit/combo-prompt-provider-translation.test.js
tests/unit/combo-prompt-txt-upload.test.js
tests/unit/combo-capabilities.test.js
tests/unit/fusion-strip-stream-options-3024.test.js
tests/unit/commandcode-executor.test.js
tests/unit/codex-fast-capacity.test.js
tests/unit/kiro-terminal-integrity.test.js
tests/unit/kiro-usage-and-tool-integrity.test.js
tests/unit/openai-responses-nonstream.test.js
tests/unit/qoder-stream-errors.test.js
tests/unit/key-access-controls.test.js
tests/unit/playground-full-chat.test.js
tests/unit/dashboard-navigation-style.test.js
tests/unit/dashboard-guard.test.js
tests/unit/combos-theme.test.js
```

Capture newly introduced failure signatures; direct-provider public success assertions are intentionally revised with explicit internal-provider replacement coverage. Known `combos-theme` `hasGridBackground` failure is baseline, not a reason to suppress unrelated tests.
- [ ] **Step 4: Scoped lint/diff.** Use source relative changed-file list and explicit ESLint invocation, no global `--fix`, no modification of old errors outside feature. `git diff --check`; secret/shell/injection scan on added lines. Parent and reviewers inspect, not only scripts.
- [ ] **Step 5: Build isolated artifact after memory check.**

```bash
HOME=/root/.hermes/cache/scratch/jrouter-models-aliases/home DATA_DIR=/root/.hermes/cache/scratch/jrouter-models-aliases/build-data MODEL_CATALOG_SYNC=off MODEL_HEALTH_SCHEDULER=false DISABLE_BACKGROUND_TOKEN_REFRESH=true ENABLE_REQUEST_LOGS=false NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS='--require=/root/.hermes/cache/scratch/jrouter-models-aliases/bootstrap.cjs --max-old-space-size=4096' npm run build
```

Use production-matching Node via verified PATH. Verify standalone server.js/custom-server.js/.next/static/public and dependency tracing. No production `.env` loaded. Start exact standalone with bootstrap preload and loopback preview port; health must return JSON `{ok:true}`. Stop own preview after tests.
- [ ] **Step 6: Run synthetic HTTP and browser matrix.** Use actual routes from Task 9 and discovery list from Task 10; raw fake socket request traces must show zero upstream for direct/unknown/forbidden calls and exact expected count for fallback/fusion. Browser all Task 14/15 interactions, both themes, desktop/mobile, responsive/keyboard/errors, buffered transport warning. No real-provider inference, host Apply, tunnel/bootstrap activity or production DB import.
- [ ] **Step 7: Independent spec then quality/security review.** Fresh reviewers receive full spec/plan, changed files, baseline/new results and fixture evidence; no concurrent edits. Parent confirms artifacts/checks and fixes actual issues with bounded task-specific cycles. No success claim from child self-report alone.
- [ ] **Step 8: Deliver local result with evidence and remaining limitations.** Report execution directory, changed files/behavior, actual tests/build/browser results, intentional compatibility break, unchanged media/Combo semantics, and no commit/push/deploy. Keep safe artifacts/documents for subsequent authorized release. Implementation authorization is not production authorization.

## Parent self-review and coverage map

- Spec §§1-4: Tasks 1/2/12, separate entity/namespace/CRUD/guards/import persistence.
- Spec §5: Tasks 3/8/12/14, runtime leases/order/backoff/reset/rotation.
- Spec §6: Tasks 4/5/6/7/8, semantic readiness, abort, bounded accounts/refresh, buffered-only exception and no replay.
- Spec §7: Tasks 6/7/8/11/16, bounded actual-answer fusion/cancel/judge/single-answer usage.
- Spec §8: Tasks 6/8/14/16, one-time injection, CodeBuddy payload, PXPIPE alias-only skip.
- Spec §9: Tasks 2/9/10/15/16, external target admission/two policies/Combo extra own grant/media compatibility.
- Spec §10: Tasks 10/11/16, discovery/lookup/caps/public model identity/upstream accounting.
- Spec §11: Tasks 12-15/16, UI contexts/status/actions/validation/accessibility.
- Spec §12: RED/GREEN and evidence gates per task + Task 16 complete matrix.
- Spec §13: Task 0 isolation and Task 16 hold/release gate. No commit or production authorization inferred.

Before execution, syntax-check JS/shell snippets, resolve current file paths/test set, and check no undefined contract names or incomplete placeholders. Record these as **document checks**, not application tests. Parent checks coverage/types itself; a reviewer may add findings but does not replace this self-review.

## Source-verified review corrections

Both read-only reviewers' findings were checked against current source and incorporated: alias no-network-replay reaches proxy/TLS/MITM fallbacks; xAI/image/MiMo preparation has explicit cancellation ownership; all refresh layers share one account recovery budget; alias Gemini typed media/tools and final Gemini/Ollama errors survive; test isolation precedes baseline; nested Combo management keeps bare IDs; key controls retain selectable Media targets; successful DB import invalidates runtime after commit only; and parent owns revisions to existing regressions. These are plan corrections, not claims that the feature is implemented or application tests have passed.
