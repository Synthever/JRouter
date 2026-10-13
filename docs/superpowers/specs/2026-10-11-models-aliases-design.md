# JRouter Models Aliases Design

Date: 2026-10-11
Status: Written specification approved by the user; implementation plan complete and source-reviewed. Runtime implementation has not started. Implementation commits, pushes, and production deployment are not authorized.
Baseline: `129b761fc6c098b29400dc0ec9e72e62d31c9b5a`.

## 1. Goal and scope

Add a **Models Aliases** menu for stable public LLM model identities backed by multiple provider models. Each alias supports a primary member, fallback, round-robin, fusion, prompt injection, and bounded initial-response waiting.

Example:

- Configured alias name: `deepseek/deepseek-v4.1-flash`.
- Public model ID: `jrouter/deepseek/deepseek-v4.1-flash`.
- Members: `cbai/deepseek-v4.1-flash` and `cmc/deepseek/deepseek-v4.1-flash`.
- Primary: `cbai/deepseek-v4.1-flash`.

External LLM requests accept only Models Aliases and LLM Combos. Direct provider-model calls are rejected, including calls with a key that previously allowed that provider model. Provider members remain callable through authorized internal routing.

This change covers LLM inference and corresponding discovery across existing compatible entry points. Embeddings, images, audio, video, web/search, and other non-LLM services retain their existing behavior.

Out of scope:

- A second provider executor or translation engine.
- A dashboard redesign, new authentication system, or new UI framework.
- Applying adaptive alias routing to existing Combos.
- Automatically migrating API-key permissions or creating aliases from provider models.
- Deleting existing model records, changing provider configuration, or cleaning orphan data.
- Production deployment during implementation without separate authorization.

## 2. Existing code and chosen architecture

Relevant existing seams:

- `src/sse/services/model.js`: provider-prefix resolution and Combo lookup; currently assumes a slash means provider/model.
- `src/sse/handlers/chat.js`: external access checks, Combo expansion, prompt injection, and account fallback.
- `open-sse/services/combo.js`: fallback, round-robin, capability ordering, and panel/judge fusion.
- `src/lib/comboPromptInjection.js`: source-format-aware prepend/append/replace injection.
- `src/lib/db/repos/combosRepo.js`: persisted Combo configuration.
- `src/lib/db/repos/aliasRepo.js` and `/api/models/alias`: existing one-name-to-one-model mappings, distinct from this feature.
- `src/app/api/v1/models/route.js`: public discovery currently includes provider models and Combos.
- `src/lib/apiKeyPolicy/` and `src/sse/services/keyAccess.js`: policy and legacy access restrictions.
- `src/shared/hooks/useModelCatalog.js`: shared picker catalog.
- `open-sse/executors/codebuddy-intl.js`: currently replaces all system/developer instructions with a provider-specific system message.

### Selected approach

Create a separate Models Aliases entity and management surface while reusing the existing routing strategies, prompt composition, provider executors, translation, usage accounting, and error classification.

The alternatives rejected in chat were making Models Aliases a special Combo type or building a second routing engine. The former conflates different contracts; the latter duplicates functionality.

Boundaries:

1. **Alias repository and management API:** persist and validate configuration; expose safe configuration and runtime status to authorized dashboard users.
2. **Public target resolver:** identify an alias or Combo by exact external ID before provider parsing; normalize identifiers for access policy.
3. **Alias routing state:** manage effective order, cooldown, rotation, and one-at-a-time recovery trials per alias member.
4. **Existing execution engine:** execute authorized provider members with alias-specific initial deadlines and retry behavior.
5. **Public catalog and response adapter:** publish only allowed virtual LLM targets and preserve their public identity in client responses.
6. **Dashboard:** manage aliases and distinguish member-selection catalogs from public invocation catalogs.

Reuse existing mechanisms at these seams. Extract only shared behavior needed by both alias and Combo paths; do not combine unrelated refactoring with this feature.

## 3. Names and public identity

Public identifiers:

- Models Alias `deepseek/deepseek-v4.1-flash` becomes `jrouter/deepseek/deepseek-v4.1-flash`.
- LLM Combo `deepseek-codebuddy` becomes `jrouter/deepseek-codebuddy`.
- A legacy bare Combo name such as `deepseek-codebuddy` remains accepted for inference compatibility, but discovery lists only the prefixed ID.
- A Models Alias is invoked through its prefixed public ID, not its bare configured name.

Rules:

- Preserve case and match the configured name exactly; do not silently lowercase provider model IDs.
- Alias names may contain nonempty slash-separated segments using letters, numbers, dots, hyphens, and underscores. Reject leading/trailing slashes, empty segments, whitespace, URL schemes, control characters, and a supplied leading `jrouter/`.
- Reject alias names equal to an existing Combo name, and reject Combo create/rename operations that would collide with an alias. Apply the same invariant in persistence, not just the UI.
- Reserve `jrouter/` as the virtual LLM namespace. No provider or legacy mapping may bypass this namespace's exact target lookup.
- An unknown `jrouter/...` target returns a model-not-found error; it must not fall through to provider parsing.
- Slash-bearing member IDs retain everything after the first provider separator. For example, the model part of `cmc/deepseek/deepseek-v4.1-flash` is `deepseek/deepseek-v4.1-flash`.

Existing single-model alias mappings remain a separate internal facility. Their existence does not authorize external LLM calls to provider targets or introduce extra public catalog entries.

## 4. Persisted configuration

Use a separate SQLite-backed Models Aliases entity integrated with the existing DB adapter and additive migration system.

An alias contains:

- Stable internal ID, created/updated timestamps, and unique configured name.
- Ordered, deduplicated member provider-model IDs.
- Primary member ID, required to belong to the member list.
- Strategy: `fallback`, `round-robin`, or `fusion`.
- Optional explicit judge member ID for fusion; absent means use the primary.
- Initial-response deadline in seconds, default **15**, validated as a finite positive value.
- Prompt-injection enabled flag, mode (`prepend`, `append`, `replace`), system prompt, and optional display identity, consistent with existing Combo settings.

Validation:

- Require at least one member.
- Members must resolve to configured LLM provider targets, not aliases, Combos, UI placeholders, URLs, or bare unresolved names.
- Primary and explicit judge must be members. Removing either requires a valid replacement in the same saved configuration; reject invalid saves rather than silently choosing another member.
- Members cannot reference Models Aliases or Combos in version one. This prevents recursive alias graphs.
- Configuration APIs require the existing dashboard-management authorization; no access via a model inference key alone.
- Rename, member replacement, strategy changes, and deletion must invalidate stale runtime decisions safely.

Display the primary at the top of the configured member list while preserving the relative order of other members. Editing configuration is deliberate and separate from automatic runtime reordering.

## 5. Runtime state and adaptive fallback

Runtime state is transient, scoped per alias and member, and shared within the serving process. It is not stored as automatic edits to configured order. Use a single process-wide state owner so separate bundled module copies cannot create inconsistent recovery locks.

Restart resets runtime order, cooldown, and rotation to configured behavior. Persisted alias configuration remains intact. No distributed-state subsystem is required for the current single-process deployment.

### Fallback

For configured order `Primary, A, B, C`:

1. Primary remains first in the configured order and UI.
2. If eligible, attempt the primary first.
3. If primary fails with a fallback-eligible provider error, start its cooldown and continue to eligible non-primary members.
4. A non-primary member that fails is moved to the end of the runtime non-primary order and put into cooldown.
5. A successful non-primary member stays in its current runtime position. Cooldown expiry alone does not restore a demoted member's original rank.
6. Subsequent requests use that effective order, skipping members still in cooldown.
7. `Reset runtime order` restores the configured non-primary order without editing configuration or clearing active cooldown/recovery protections.

Each request takes a stable candidate snapshot and attempts each member at most once. Failures affect later requests; reordering must not make the current request repeat a failed member or skip an untried candidate accidentally.

Example: primary and A fail, then B succeeds. During cooldown, later requests start with B, then C. Primary remains visually first and becomes eligible for a recovery trial after its cooldown.

### Cooldown and recovery

- Temporary upstream/server/network failures: **30 seconds**, then **60**, **120**, and **300 seconds** on consecutive failed recovery attempts; further consecutive failures remain at 300 seconds.
- Success resets the consecutive-failure backoff.
- Authentication/payment-related member failures use existing classification and its **2-minute** cooldown where applicable.
- Rate limit honors provider-reported reset/Retry-After when available, using the existing provider-specific limits and protections. Otherwise use existing rate-limit backoff rather than interpreting it as a generic 30-second server failure.
- Member eligibility must respect existing per-account/model locks. Alias runtime state cannot make a locked credential available or unnecessarily extend a provider's authoritative reset time.
- After cooldown, only one request may claim a recovery attempt for the recovering member. Other requests use available alternatives rather than waiting behind that trial.
- If that recovery succeeds, primary resumes first-choice status; a recovering non-primary member remains in its demoted position.
- Release recovery ownership on success, failure, timeout, cancellation, and configuration invalidation. Stale attempts must not overwrite state for newly edited configuration.

Do not demote/cool down a member for invalid client input, JRouter API-key quota/access errors, or client disconnect/cancellation. Classify the cause before updating health state.

If no member is eligible, return an OpenAI-compatible unavailable response with the earliest useful retry time where known; do not wait for cooldown expiry inside the request.

### Round-robin

- Rotate first choice among eligible members, including the primary.
- Primary remains first in the UI but does not override round-robin selection.
- Skip members in cooldown and preserve one-at-a-time recovery protection.
- Failures fall through to other eligible members, without repeating the failed member in that request.
- Keep rotation state scoped per alias; do not alter existing Combo rotation behavior.

## 6. Initial-response deadline, cancellation, and streaming

The alias deadline defaults to **15 seconds per attempted member**, including credential selection/refresh and any account switching. It is not restarted for each account or nested executor retry.

A qualifying first output is a valid text delta, reasoning delta, or tool-call event in the provider's translated response. HTTP 200 headers, keep-alive comments, and empty/metadata-only events do not qualify.

Transport observability decision approved during planning: request upstream streaming wherever supported, even when the client wants JSON. Keep providers that expose only a complete buffered answer eligible as members. For those transports, the deadline necessarily measures availability of the complete answer, not an unobservable internal first token. Show this limitation in the alias settings/member metadata and permit adjusting the deadline; do not claim a first-token guarantee for such transports.

Requirements:

- For alias routing, do not run repeated same-upstream retry sleeps before moving to another member after a fallback-eligible failure.
- Refresh or account selection work must stay inside the member's overall deadline, not add an unbounded delay outside it.
- Propagate deadline/client cancellation through the real execution path. Do not merely race promises while leaving losing upstream requests alive.
- Buffer enough initial output to decide whether the member produced valid output before committing the client response. Do not send client success headers that make pre-output fallback impossible.
- On deadline expiry, abort the outstanding member effort, release resources/recovery ownership, and proceed to the next eligible member.
- Once valid output has started and is delivered to the client, remove the initial deadline. Preserve established stream-stall safeguards and allow long answers to finish.
- Do not switch models after response output is committed to the client. A later stream failure must be surfaced in the client's protocol instead of splicing another model's answer into it.
- For non-streaming clients, stop fallback once the selected member has begun valid model output, even if output is still being accumulated into JSON. This avoids replaying a generation after it has started.

The 15-second limit bounds initial member waiting, not full response duration or total alias request time. Several unavailable members can each consume their own deadline. Abort propagation must be verified; cancellation does not guarantee an upstream provider will stop billing work already accepted.

Never replay tool execution already performed by a client. Provider tool-call events count as valid output, after which automatic member failover stops.

## 7. Fusion

Reuse the existing panel-and-judge fusion engine; this is not a faster form of sequential fallback.

- Invoke eligible members in parallel as panel participants. Skip members in cooldown and respect recovery ownership.
- Primary is the default judge. An explicitly selected judge must also be a configured member.
- If the chosen judge is unavailable or fails before valid output starts, try another eligible configured member as judge.
- With two or more usable panel answers, ask a judge to synthesize one final answer.
- With exactly one usable panel answer, return that answer without invoking another generation solely to obtain the same result. Adapt it to the client protocol as needed.
- With no usable panel answers, return an unavailable error.
- Panel calls are non-streaming toward the fusion collector and retain the existing protection against panel tool loops. The final judge preserves supported client tools and streaming behavior.
- The initial 15-second member deadline stops after the member's first valid output. It is not a 15-second cap on completion of the entire panel answer.
- Keep a separate bounded panel collection window: inherit the existing defaults of a 90-second hard collection timeout and 8-second straggler grace once the required two successful answers are available, capped by actual panel size.
- Abort outstanding panel work when collection ends or the client disconnects; do not leave stragglers generating silently. Do not classify collection-grace cancellation or client cancellation as a provider failure.
- Real panel/judge provider failures update the corresponding member's runtime health; merely omitting an answer after the collection window is not sufficient evidence to demote a healthy model.
- Primary may be called once as a panel member and again as judge. Usage accounting must include actual panel and judge attempts; this mode can cost more than a single completion.

These improvements apply to the Models Aliases path without silently changing existing Combo fusion semantics.

## 8. Prompt injection and CodeBuddy compatibility

Use existing source-format-aware prompt composition. Support the Combo controls already approved: enable/disable, prepend/append/replace, prompt editor, `.txt` upload, and optional display identity.

Apply alias prompt composition once before selecting members. Each member attempt receives an isolated composed body so executor mutation or fallback cannot accumulate duplicate instructions. Panel and judge receive the composed instructions; the judge's synthesis directive is separate from reinjecting the configured prompt.

Preserve existing client message blocks, tools, instruction modes, and cache-sensitive fields where the format supports them. Do not duplicate instructions through account retries.

Optional saver decision approved during planning: skip PXPIPE for Models Aliases because its current local CPU transform cannot be aborted. Do not change the global PXPIPE setting or existing Combo behavior. Keep other savers where cancellation can be propagated. Record the alias-only skip in internal saver diagnostics, without adding a new worker subsystem.

CodeBuddy international currently removes all system/developer instructions and replaces them with a provider-specific system message. Adjust this path narrowly so approved alias instructions survive while the required CodeBuddy request shape is preserved. Retain unrelated direct/Combo behavior unless a shared fix is required and explicitly covered by compatibility tests. Verify the actual executor-boundary payload, not merely the presence of prompt settings in the UI.

Prompt composition does not guarantee that a provider will accept or follow arbitrary instructions; provider errors remain visible and follow the same routing classification.

## 9. External routing, API-key policy, and compatibility

### Target admission

For every public LLM inference entry point:

1. Authenticate and apply endpoint/key-level admission as currently required.
2. Resolve the requested public alias/Combo identity before provider/model parsing, bypass handling, credential lookup, or upstream dispatch.
3. Reject direct provider-model targets and standalone legacy mappings to provider models.
4. Validate access to the requested virtual target.
5. Expand configured members through an internal server-owned execution path.

No client-controlled field, header, or query may mark a provider request as trusted/internal. Internal member execution must not turn into an external bypass.

Audit the existing LLM entry points, including Chat Completions, Responses (and compact), Messages (and token-count handling), Gemini-compatible chat routes, Ollama-compatible chat/generate, and any existing LLM adapters. Apply discovery/admission consistently where they select a model. Non-LLM routes remain untouched.

### Allowed/Blocked Models

- A key must allow the requested alias/Combo when an allowlist is present. Permission to an individual member does not grant access to its parent target.
- Existing bare Combo permission and `jrouter/<combo-name>` are equivalent. Normalize without changing stored policies automatically.
- An allowed virtual target grants only its configured internal members. Blocked member identifiers still override that grant.
- Existing legacy access restrictions and current policy rules must both remain enforced.
- Models Alias member/judge selection and fallback cannot bypass a block or select a model outside its configured members.
- Compatibility decision approved during planning: existing Combo judges and capacity adapters may remain outside the Combo member list, but those extra models must pass both key-policy systems on their own. They cannot inherit the parent Combo grant. An unrestricted key retains existing Combo configuration behavior; direct public calls to those provider models remain forbidden.
- API keys that only allow provider IDs do not gain newly created aliases automatically. Users must deliberately select virtual targets.
- Unknown alias and access-denied requests must not contact providers.

### Client migration

Direct provider-model LLM calls become incompatible by design. Existing bare LLM Combo calls remain supported. Creating aliases and updating client model IDs/API-key allowlists is explicit user work, not an automatic migration.

## 10. Discovery, capabilities, response identity, and accounting

### Public catalog

`/v1/models` publishes only prefixed Models Aliases and LLM Combos permitted for the caller. Do not publish raw provider models, provider custom-model records, or legacy one-model alias mappings.

Apply the same virtual-target identity and access semantics to corresponding existing LLM model lookup and compatible discovery surfaces. Media-specific catalogs retain their current behavior.

- Return unique IDs and existing OpenAI-compatible envelope shape.
- Omit virtual targets with no valid authorized configured member rather than exposing invalid or fully blocked targets. Temporary cooldown alone does not remove a virtual target from discovery; catalog identities stay stable.
- Publish context/output limits conservatively from the smallest supported value across configured members, not solely from the primary. Do not temporarily inflate advertised limits because a low-limit member is in cooldown.
- Reuse established capability aggregation and provider-specific limit resolution. Do not advertise capabilities based only on an arbitrary alias name or claim that all members support a capability merely because one does.
- Keep existing capability protection/adapter behavior from silently dropping input. An alias-only rule must not automatically change existing Combo semantics.

### Responses

Client-facing model identifiers use the virtual public identity, including streaming chunks/events and non-streaming envelopes where the protocol exposes a model field. For a bare legacy Combo invocation, return the canonical `jrouter/<combo-name>` identity rather than the selected provider ID.

Do not rewrite tool IDs, provider session IDs, user content, or arbitrary strings containing model-like text.

### Internal logs and usage

Retain actual provider/model/connection attribution in existing logs and usage accounting. Associate the requested virtual target where needed to diagnose routing, but do not conceal real upstream cost or publish credentials in runtime status.

## 11. Dashboard and picker behavior

Add `/dashboard/models-aliases` and a **Models Aliases** sidebar entry using the existing dashboard shell, Combo patterns, semantic tokens, and both themes.

Management controls:

- Create, edit, and delete an alias with existing validation/error/confirmation conventions.
- Name input and read-only preview `jrouter/<name>`.
- Provider-member picker, ordered list, primary selection, removal, and reorder controls.
- Primary pinned visually at the top with a Primary label; distinguish configured order from effective runtime order.
- Strategy selector; judge selector within members for fusion.
- Editable initial-response deadline, default 15 seconds.
- Prompt-injection controls and `.txt` upload.
- Read-only member runtime status: available, cooldown with time remaining, or recovery trial in progress.
- Reset runtime order without modifying saved configuration.

Picker separation:

- Management pickers for alias/Combo members continue to expose configured provider models, respecting the shared deleted-provider filter.
- Playground and other external LLM invocation/configuration pickers expose only Models Aliases and Combos, using their canonical public IDs.
- Key allowlist selection offers virtual public targets. Blocked-model management retains member selection where required to express the approved member-level blocking rule.
- Non-LLM pickers keep current behavior.

UI requirements: meaningful empty/loading/error states; disabled submit for invalid primary/judge/member configuration; responsive content without horizontal overflow; keyboard-operable selection/reorder/dialogs; dark and light mode consistency. Do not introduce unrelated visual changes.

## 12. Verification and acceptance criteria

Use deterministic fake upstreams and isolated SQLite data. Real provider inference is not required for feature verification and must not be generated merely to test UI.

### Configuration and identity

- Create/edit/delete alias, persistence across restart, deduplication, primary/judge membership validation, and invalid member rejection.
- Exact slash-bearing alias matching, nested provider model ID preservation, duplicate name protection in both alias/Combo directions, and unknown namespace rejection.
- No recursive alias/Combo member graphs in version one.

### Fallback and runtime

- Primary first when available; skip during cooldown; never demote primary in UI/configuration.
- Failed non-primary moves to runtime tail; configured order unchanged; current request attempts each candidate once.
- Backoff 30/60/120/300 seconds, success reset, rate-limit resets, auth/payment cooldown behavior, and existing account-lock interaction.
- Exactly one concurrent recovery trial; alternatives do not wait behind it.
- Configuration edit/reset/delete safely invalidates stale state; restart restores configured runtime behavior.
- Client errors, policy/quota errors, and cancellations do not penalize members.
- All unavailable produces explicit error/retry information rather than waiting for cooldown expiry.

### Deadlines and streaming

- Mock clocks and delayed upstreams prove a 15-second overall initial member deadline, including multiple account/refresh attempts.
- HTTP headers/heartbeat do not satisfy readiness; text, reasoning, and tool events do.
- Early failure immediately advances without repeated provider retry sleeps.
- Abort reaches active execution; canceled attempts cannot dispatch afterward and their owned work/readers are stopped. Shared refresh/project work may continue only while other legitimate waiters still own it; cancel it when the last owner leaves. Release resources and recovery ownership.
- Valid early output permits completions longer than 15 seconds.
- No fallback or mixed-model stream after output begins; later errors are protocol-correct.
- Client abort stops attempts without trying another member.

### Strategies and prompt

- Round-robin includes primary and skips unavailable members.
- Fusion quorum/collection limits, primary/explicit judge, judge failover before output, single-answer reuse, all-failed error, panel cancellation, and actual usage accounting.
- Prompt composed once for fallback/account changes/panel/judge, correct modes and source formats, `.txt` behavior, and CodeBuddy executor payload retention.

### Policy and public API

- Catalog includes only canonical alias/Combo IDs permitted by both key-policy systems.
- Allowing a member never grants the parent; member blocks win; existing bare Combo policies/calls continue to work.
- Reject direct provider-model LLM calls across every supported LLM entry point before any upstream request.
- Media endpoints/catalogs retain baseline behavior.
- Published limits remain conservative across primary/cooldown changes.
- Client model fields preserve public identity in JSON and streaming without altering actual internal usage attribution.

### UI and compatibility

- Browser checks for Models Aliases management, member selection, primary pinning, strategies/judge, prompt upload, timeout validation, runtime reset/status, and error/empty/loading states.
- Verify public pickers versus management pickers; test desktop/mobile, both themes, keyboard, overflow, and runtime/asset errors.
- Existing Combo configuration, prompt injection, fallback, round-robin, fusion, capacity adapters, and legacy Combo names pass scoped regression checks except the explicitly approved public catalog/admission changes.
- Run scoped lint, relevant tests, standalone build, synthetic smoke, and independent review. Identify pre-existing suite failures separately rather than fixing unrelated code.

## 13. Implementation and release gates

This document is a design specification, not an implementation plan or authorization to modify runtime code.

1. User reviews and approves this written specification.
2. Invoke writing-plans to create the implementation plan; any additional implementation choice affecting public behavior must be raised rather than silently assumed.
3. Implement and verify in an isolated working directory/worktree, using isolated data and matching production dependencies.
4. Do not commit/push/deploy implementation code without separate explicit authorization. Do not commit the design document unless that action is authorized.
5. An eventual approved release uses additive DB migration, a consistent private backup, complete runnable artifact rollback, synthetic smoke, public API/asset gates, and live browser verification.

Keep existing production provider credentials, API-key policies, Combo configuration, telemetry, and unrelated untracked files intact.
