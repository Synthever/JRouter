# Playground Chat-First Redesign

**Date:** 2026-10-31
**Route:** `/dashboard/playground`
**Reference:** `docs/templates/playground/main.html`, screenshots in `docs/templates/playground/*.png`
**Status:** Approved design, implementation plan pending
**Supersedes:** `2026-10-30-playground-redesign-design.md` (modes, execution rail, KPI cards). That layout is not part of this design; its shipped code was reverted in `1d02a55a`.

## 1. Context & Objectives

The current page is a single chat workspace inside the dashboard shell: a toolbar with a model trigger, a transcript, a generation-settings popover and a composer. It works but carries one layer of chrome the reference does not have, and it lacks the affordances the new template defines.

This design moves the Playground to the template's chat-first shape:

1. No page toolbar. The model trigger, history, think and settings controls live in the composer, as in the reference.
2. A real conversation list with persistence, duplicate, delete and search.
3. A full playground settings panel: system prompt with presets, temperature slider, max output tokens, AI helper, export and clear.
4. Working slash commands, an export-code dialog (cURL / JavaScript / Python), raw/rendered toggle, per-message delete, retry and scroll-to-bottom.
5. The conversation title surfaced in the dashboard header breadcrumb.
6. One shared model picker body with a rail variant, used by the Playground and by the Combos pickers.

Everything is real: no fabricated metrics, no mock replies, no invented gateway fields. Anything the reference invents that has no backing data is omitted (see §14).

## 2. Decisions Taken During Brainstorming

| Question | Decision |
| --- | --- |
| How real should the template behaviour be? | Full parity. AI helper is ON by default and makes real extra billed calls for auto title and follow-ups. |
| Model picker | `ModelPickerList` gains a `variant="rail"` mode. Playground and the three Combos call sites adopt it; CLI Tools modals keep `variant="chips"`. |
| Conversation title | Rendered in the dashboard header breadcrumb through a small store; the page itself adds no title bar. |

Deliberate deviations from the reference, approved with the design:

1. **No attach (+) or microphone button.** In the template both only raise "not part of this mockup"; the app has no attachment or voice pipeline. Omitting them is more honest than a disabled control.
2. **The real per-message metric line is kept** (latency, prompt/completion tokens, finish reason, reported model). The template's mock replies have no data for it, but the page does. It renders as a small mono line under the message actions.
3. **Top P and a custom max-token field are kept.** The template shows four fixed max-token presets and no Top P; the current page allows both. Dropping them would be a capability regression. Presets stay in front, the custom field sits underneath.
4. **Think is a real payload field.** ON sends `reasoning_effort: "high"`; OFF sends nothing and lets the provider default apply. The gateway already maps that field through `open-sse/translator/concerns/thinkingUnified.js`.
5. **Feedback uses the shell notification store** (`useNotificationStore`, top-right), not a bespoke bottom toast. One feedback system for the whole dashboard.

## 3. Data Sources

All client-side; no new API route.

| Source | Used for |
| --- | --- |
| `GET /api/providers` | active connections, provider names/colours, "no providers" empty state |
| `GET /api/models/alias` | model aliases for the picker |
| `GET /api/keys` | first active key as `Bearer` for turns and helper calls |
| `POST /api/v1/chat/completions` | turns (SSE), AI helper calls (non-stream), title generation |
| `localStorage` | conversations, settings, favorites (keys in §6) |

A failed fetch degrades only its own surface: provider/alias/key failures raise the existing inline notice and never block typing. The chat call is the only hard dependency.

**Not available, therefore not shown:** per-request cost, upstream weights, `x-jrouter-*` headers, cache stats per turn.

## 4. Layout

Full height, no page scroll. `DashboardLayout` keeps `/dashboard/playground` in `isFullHeightPage` with `h-dvh`.

```
.page                    flex column, height 100%, padding 20px 32px 24px
└── .card                flex 1, border 1px --line, radius 24px, bg --surface, min-height 0
    ├── .viewport        position relative, flex 1, min-height 0
    │   ├── .transcript  overflow-y auto, padding 24px 28px
    │   │   └── .column  max-width 820px, margin-inline auto
    │   └── .scrollPill  absolute right 24px bottom 14px, hidden when at bottom
    └── .composerShell   border-top 1px --line, padding 14px 20px
        └── .column      max-width 820px
            ├── .composer  bg --surface-card, radius 22px, padding 14px 14px 10px 18px
            └── .hint      centred, hidden below 700px
```

Responsive: page padding drops to 12px below 640px; the card keeps its radius but loses the outer margin. The transcript column stays fluid; assistant cards fill it. No second scroll container is introduced.

## 5. Visual System

Only existing tokens: `--surface`, `--surface-2`, `--surface-card`, `--surface-hover`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`, `--brand-lavender`, `--brand-pink`, `--brand-ochre`, `--brand-mint`, `--danger`, `--pos`. No new colour values.

**Empty state.** Centred in the viewport: a decorative inline SVG of three arcs (pink, lavender, ochre) with a peach dot, `aria-hidden="true"`; title `Start a conversation` at `clamp(24px, 3vw, 32px)`, weight 500, letter-spacing `-0.05em`; a hint that reflects real state ("Pick a model, then send your first message through JRouter.", "No providers connected yet…", or "Test <model> through JRouter."); then a 2×2 grid (max 640px) of four suggestions. Clicking a suggestion fills the composer, it does not send.

**User message.** Right-aligned bubble, `--brand-lavender` background, `#0a0a0a` text, radius `20px 20px 6px 20px`, max width `min(580px, 90%)`, `pre-wrap`. Under it a micro row: `YOU` in 11px uppercase 0.12em, then copy and delete icon buttons.

**Assistant message.** Bordered card, radius 24px, padding `16px 24px 20px`, border `--line`.
- Header: 32px provider/model tile, bold model name, muted provider or `combo` tag, muted status (`waiting…`, `thinking…`, `writing…`, `for 4.2s`), then actions pushed right: `Retry` (last assistant message only), `Raw`/`Rendered`, `Copy`, and an icon-only `Delete`.
- Divider under the header.
- Optional thinking block: sparkle icon, `Thinking…` while streaming, `Thought for N s` when finished, chevron; body indented 28px with a 2px left border, `--text-2`, `pre-wrap`, max height 320px with its own scroll.
- Markdown body: 15px / 1.7, headings 20px weight 600, lists padded 22px, inline code on `--surface-card`, code blocks on the dark surface used today.
- Follow-up pills for the last completed reply when the AI helper is on and returned suggestions.
- Metric line: mono 10.5px, `--text-3`, parts separated by `·`.
- Error state: existing bordered danger block with the failure message and a Retry button.
- Model-switch divider between turns: hairline, mono 10.5px, `Model switched to <name>`.

**Streaming.** Waiting shows three pulse dots plus the status in the header; text streams into the markdown body with the existing caret. Stopping keeps partial text and marks `stopped` in the metric line.

**Scroll pill.** Black pill, white text, down icon and `Scroll to bottom`, shown when the reader is more than 80px from the bottom.

**Composer.** Card on `--surface-card`. Auto-growing textarea (max 200px, mobile caps preserved from the current sheet), placeholder `Ask <model> anything, or type / for commands…`. Toolbar row:
- model trigger: bot tile + name + chevron, `aria-haspopup="dialog"`, `aria-expanded`, pressed state `--brand-lavender`;
- `History` with a count badge;
- `Think` toggle, `aria-pressed`;
- `…` settings trigger, `aria-expanded`;
- spacer, then the 40px round send button (arrow up) or stop button (square) while streaming.

Hint under the composer: `Enter to send · Shift + Enter for a new line`.

**Settings popover.** Anchored above the composer, width `min(440px, 100%)`, max-height with internal scroll:
- header `Playground settings` + close;
- `System prompt` label and live character count, 96px textarea;
- four preset pills: `Default`, `Senior dev`, `JSON output`, `Concise` (exact text from the template; the active one is pressed);
- `Temperature` slider 0–2 step 0.05 with the value at two decimals and the labels `0.0 (Precise)`, `1.0 (Balanced)`, `2.0 (Creative)`;
- `Max output tokens` segmented 1024 / 2048 / 4096 / 8192 plus a `Custom` number field that accepts any integer ≥ 1;
- `Top P` number field (0–1, empty = provider default);
- `AI helper requests` switch, `role="switch"`, description `Auto title and follow-up suggestions. Extra billed calls.`;
- `Export code` (secondary) and `Clear` (danger outline, two-step confirm within 3s).

**Model picker.** Anchored above the model trigger, width `min(720px, calc(100vw - 32px))`, max height `min(480px, 100dvh - 260px)`:
- search field at the top, lavender border while focused;
- left rail (210px): `All models`, `Favorites` (only when non-empty), `Combos` (only when present), then each provider with its filtered count; selected row on `--brand-lavender`;
- right list: sticky group header `<PROVIDER> (n)`, rows with favorite star (Playground only), provider glyph or combo tile, model name, `custom` tag, capability badges (vision, reasoning), and a check for the currently selected model;
- keyboard: ↑/↓ move, Enter selects, Esc closes; search input keeps focus;
- empty state `No models match "<query>".`;
- below 620px of container width the rail becomes a horizontal scrolling strip above the list (container query, so narrow modals degrade too).

**History modal.** `Modal` with `bare` + `trapFocus`: header tile, `Conversations (n)`, subtitle `Switch or manage saved chat sessions`, `New` button, close. Search by title, model or message text. Rows: title, `Active` badge, model name, message count, relative time (`just now`, `12m ago`, `3h ago`, `2d ago`), duplicate, and two-step delete. Empty search result message. Selecting a row closes the modal and switches.

**Export modal.** `Export code` title, one line of context, pill tabs `cURL` / `JavaScript` / `Python`, dark `pre`, footer `Close` + `Copy`.

Export content is built from the active conversation and the current settings, never from a stored key:
- URL: `window.location.origin` + `/v1/chat/completions`.
- Body: `{ model, messages, temperature, max_tokens, stream: true, ...(topP ? { top_p } : {}), ...(think ? { reasoning_effort: "high" } : {}) }`; `messages` is the system prompt (when non-empty) followed by every user/assistant message with non-empty content. If no user message exists, a single `Hello` is added.
- Credential: `$JROUTER_API_KEY` (cURL), `process.env.JROUTER_API_KEY` (JavaScript), `os.environ["JROUTER_API_KEY"]` (Python). No real key is ever rendered.

## 6. State & Persistence

```
sessions:  [{ id, title, model, messages, updatedAt }], activeId
           model: { value, name, providerId, providerName, providerColor, isCombo } | null
message:   { id, role: "user"|"assistant"|"divider", content, reasoning, status,
             modelName, providerId, providerName, isCombo, startedAt,
             elapsedMs, thinkingMs,
             meta: { latencyMs, usage, finishReason, responseModel, requestedModel, stopped },
             error, followUps }
settings:  { system: "", temperature: 0.7, maxTokens: 2048, topP: "", helper: true, think: false }
ui:        pickerOpen, settingsOpen, historyOpen, exportOpen, commandsOpen,
           rawById, thinkingOpen
```

| Key | Contents |
| --- | --- |
| `jrouter.playground.sessions.v1` | `{ activeId, conversations }` |
| `jrouter.playground.settings.v1` | the settings object |
| `jrouter.playground.favorites.v1` | array of model values |

Storage rules: every read/write is guarded; malformed payloads are ignored and replaced with defaults; at most 50 conversations and 200 messages per conversation; `reasoning` is truncated to 4000 characters before saving; assistant messages restored with `status: "streaming"` become `done` when they have text and `empty` otherwise. On `QuotaExceededError` retry once without reasoning bodies, then keep the session in memory and log a warning.

Default settings are explicit on purpose: the playground always sends `temperature` and `max_tokens`, so the panel's numbers match the request. `topP` is omitted while empty.

## 7. Conversation Lifecycle

- **New chat** stops any stream; if the active conversation has no messages it just focuses the composer (template behaviour), otherwise it creates a conversation with the same model and title `New chat`.
- **Switch** stops streaming, sets `activeId`, restores that conversation's model and clears transient UI state.
- **Duplicate** copies messages with fresh ids, appends ` (copy)` to the title and moves it to the top.
- **Delete** is two-step. Removing the last remaining conversation creates a fresh empty one.
- **Clear** empties the active conversation and resets its title; two-step confirm.
- **Model switch** appends the `Model switched to <name>` divider and stores the new model on the conversation.
- **Auto title** replaces `New chat` after the first user message when the helper is on (§9); the local fallback is the first six words, capitalised.
- Every mutation updates `updatedAt` and writes through to storage.

## 8. Turn Engine

Moved into `usePlaygroundChat` with the existing behaviour intact.

- Request: `POST /api/v1/chat/completions`, headers `Content-Type: application/json`, `Accept: text/event-stream`, `Authorization: Bearer <first active key>` when present.
- Body: `{ model, messages, stream: true, temperature, max_tokens, ...(topP ? { top_p } : {}), ...(think ? { reasoning_effort: "high" } : {}) }`.
- Messages: `system` first when the prompt is non-empty, then user/assistant turns with non-empty content. Dividers are never sent.
- Streaming: same reader/parsing loop; handles `choices[0].delta.content`, `delta.reasoning_content`/`reasoning`, `usage`, `finish_reason` and chunk `model`. A `content-type: application/json` response is finalised as a single reply.
- Timing: `firstTokenMs` (first content delta), `thinkingMs` (first reasoning delta → first content delta, or → end), `elapsedMs` (total). Missing values are omitted, never zero-filled.
- Stop: aborts the controller, finalises as `done` with `stopped: true`, keeps partial output.
- Error: marks the message `status: "error"` with the message, restores the prompt into the composer for editing.
- Retry: only the last assistant message; replays its question against the same model with history truncated at that question.
- Delete: removes exactly one message (template behaviour); if it was the last reply, its follow-ups disappear with it.
- Raw toggle: per message id, renders the raw text in a `pre` with `pre-wrap` instead of markdown.
- Scrolling: auto-follow only while the reader is within 80px of the bottom.

## 9. AI Helper (extra billed calls)

Runs only when `settings.helper` is true, a conversation is active and no turn is streaming. Both calls use the same model and `Bearer` key, are aborted on switch / new / delete / clear / unmount, never block send or streaming, and fail silently (console warning only).

**Auto title** — once per conversation, after the first user message. Non-stream request with a system instruction to return a 3–6 word title, `max_tokens: 24`, `temperature: 0.3`. The reply is trimmed of quotes/backticks, collapsed to one line and capped at 60 characters. Empty or failed → local fallback title.

**Follow-ups** — once per completed reply that is the latest message in its conversation, has text and is neither stopped nor errored. Non-stream request with the last six messages (each capped at 1200 characters) and a system instruction to return exactly three short follow-up questions as a JSON array of strings, `max_tokens: 160`, `temperature: 0.7`. Parsing is lenient: strip code fences, take the first `[...]` block, keep strings only, cap at three, drop empties. Failure yields no pills.

Pills render under the last completed reply. Clicking one sends it immediately as the next message (template behaviour). The settings description states that these are extra billed calls.

## 10. Shared Model Picker (`variant`)

`ModelPickerList` keeps its current chip rendering as the default and gains `variant="rail"`. New optional props: `favorites` (array), `onToggleFavorite` (function). Selection semantics are unchanged: `onSelect(model, group)` with `{providerId, name, color, isCombo}`, plus `addedModelValues` for multi-select consumers.

Rail internals: a container-query wrapper (`container-type: inline-size`), search, rail + list grid, a `data-picker-rail` rail, `data-model-row` rows and `data-model-group` headers. Rows do not reuse `data-model-option`, so the existing `.modelPicker [data-model-option]` overrides in `DashboardControls.module.css` cannot repaint them. Keyboard handling lives in the rail variant: ↑/↓ over visible rows, Enter selects, optional star toggle with `f` is not added (YAGNI).

Adoption:
- `ModelPickerPopover` (Playground) renders the rail variant with favorites from `jrouter.playground.favorites.v1`.
- `ModelSelectModal` accepts `variant` (default `"chips"`); the three Combos call sites pass `variant="rail"`. CLI Tools keep chips because those dialogs are narrow and multi-step.
- `ApiKeySettingsSections` keeps the chip list (multi-select allow-list).

## 11. Header Title Store

New `src/store/headerTitleStore.js` (zustand): `{ crumbs: [], setCrumbs(crumbs) }`, where a crumb is `{ label: string, href?: string }`. The Playground sets `[{ label: "Playground", href: "/dashboard/playground" }, { label: <active title> }]` in an effect keyed on the title and clears on unmount. `Header` prefers store crumbs over its static `getPageInfo` result, so any future page can publish crumbs the same way. No route string for the playground is added to `Header.js`; the two existing "no playground title" assertions stay valid.

## 12. Accessibility & Responsive

- Transcript: `role="log"`, `aria-label="Conversation"`, focusable, scroll pill with an explicit label.
- Popovers: `role="dialog"` + `aria-label`, `aria-expanded` on the trigger, Escape closes, outside click closes, focus returns to the composer.
- Switch: `role="switch"` + `aria-checked`; segmented controls use `aria-pressed`; favorite star uses `aria-pressed`.
- Modals use the shared `Modal` with `trapFocus`.
- `:focus-visible` uses the existing 2px text outline; `prefers-reduced-motion` disables the caret, dots, popover and pill transitions.
- Command palette: `role="listbox"` with `aria-selected` items, driven from the textarea (↑/↓/Enter/Tab/Escape), `aria-controls` on the textarea.
- Breakpoints: 1024px (shell padding), 700px (hide hint, icon-only message actions, single-column suggestions, full-width popovers), 620px container (picker rail becomes horizontal), 640px (page padding 12px). The mobile and landscape composer caps from the current sheet are preserved.

## 13. Architecture

```
src/app/(dashboard)/dashboard/playground/
  page.js                        unchanged server wrapper
  PlaygroundPageClient.js        orchestration: sessions, settings, active id, handlers   ~420
  usePlaygroundChat.js           turn engine (moved from the client)                      ~260
  usePlaygroundSessions.js       conversations state, persistence, CRUD                   ~200
  usePlaygroundHints.js          title + follow-up calls with abort                       ~140
  PlaygroundTranscript.js        viewport, empty state, scroll pill, message list          ~120
  PlaygroundMessage.js           one message: actions, thinking, raw, follow-ups           ~230
  PlaygroundEmpty.js             SVG art + suggestions                                     ~60
  PlaygroundComposer.js          textarea, toolbar, trigger, command palette, hint          ~240
  PlaygroundSettingsPopover.js   system prompt, presets, sampling, helper                  ~200
  PlaygroundHistoryModal.js      conversation list, search, duplicate, delete               ~180
  PlaygroundExportModal.js       language tabs, generated code, copy                        ~110
  ModelPickerPopover.js          rail popover anchored above the composer (rewritten)       ~90
  playgroundUtils.js             storage, export builders, parsing, formatting             ~200
  playground.module.css          page, card, transcript, messages, composer, popovers       rewrite
  playground-dialogs.module.css  history + export                                          new
  playground-markdown.module.css restyled to the template type scale                       rewrite

src/shared/components/ModelPickerList.js (+ module.css)   rail variant + keyboard + favorites
src/shared/components/ModelSelectModal.js                 variant prop
src/store/headerTitleStore.js                             new
src/shared/components/Header.js                           store crumbs
src/app/(dashboard)/dashboard/combos/page.js              three call sites pass variant="rail"
```

`PlaygroundMarkdown.js` is kept as-is; only its stylesheet changes. No server code changes.

## 14. Testing & Verification

**Automated (Vitest, source-contract pattern — the suite runs without a JSX transform)**
- `tests/unit/playground-redesign-shell.test.js`: no top toolbar (`styles.toolbar` absent), model trigger lives in the composer file, card radius 24px, scroll pill present, empty-state art present, composer has no box-shadow.
- `tests/unit/playground-redesign-behavior.test.js`: helper calls are non-stream with `max_tokens`, export builders use `$JROUTER_API_KEY` and `/v1/chat/completions`, command list, storage keys, session caps, raw/delete/favorite handlers.
- `tests/unit/model-picker-rail.test.js`: `variant` prop, container query, keyboard handler, `ModelSelectModal` passes the variant, Combos call sites pass `"rail"`.
- `tests/unit/header-title-store.test.js`: store shape, `Header` uses it, no new `/playground` literal in `Header.js`.
- `tests/unit/playground-full-chat.test.js` stays green unchanged (mobile/landscape composer caps, no page header, layout classes).

**Lint:** `npx eslint` on every touched file.

**Manual, dev server on 20128 with `DATA_DIR=%APPDATA%\jrouter`**
- Empty state → pick a model → send: streaming text, thinking block, metric line, scroll pill.
- Raw/rendered toggle, copy, delete one message, retry last reply, stop mid-stream (partial text kept).
- Settings: temperature/max tokens/Top P/helper survive reload; a non-empty system prompt appears first in Export.
- History: new, switch, duplicate, delete, search; conversations and titles survive a reload.
- Header breadcrumb shows the active conversation title and clears when leaving the page.
- Export dialog: three tabs render and copy valid code with the env placeholder.
- Command palette: all six commands, arrow keys, Escape.
- Picker: rail counts react to the search, keyboard navigation, favorites persist, Combos picker uses the rail too.
- Viewports 1440×900, 1280×800, 1024×768 and 390×844; no clipped composer, no page scrollbar.

**Build:** `npm run build` in the background (webpack, repo-wide lock, 15–20 min). If another agent holds the lock, report it instead of forcing.

## 15. Out of Scope

- Compare mode, JSON API inspector, execution rail, KPI cards (the superseded spec).
- File attachments, voice input, image input, tools/function calling UI.
- Per-request cost, cache/compression stats, route-plan cards.
- Share links, prompt library, server-side conversation storage, cross-device sync.
- Changes to `Sidebar`, the dashboard shell layout, or `docs/templates/**`.
- Migrating CLI Tools pickers to the rail variant.

## 16. Risks

- **AI helper adds one or two extra requests per turn.** A title call once per conversation and a follow-up call after the latest reply. Mitigated by an explicit toggle, honest copy, abort on navigation and silent failure. A user who turns the helper off gets exactly one request per message.
- **localStorage growth.** Bounded by the 50/200 caps and the 4000-character reasoning truncation; quota failure degrades to in-memory with a warning instead of losing the conversation.
- **Shared picker blast radius.** The rail variant is additive and opt-in. CLI Tools and the endpoint allow-list keep the chip list, so their existing overrides remain valid.
- **`reasoning_effort` on providers that reject it.** Only sent when Think is ON; the gateway's `paramSupport` drops it for the providers already known to reject it, and everything else is provider-dependent. If a provider errors, the message surfaces the real error and the toggle can be turned off.
- **Deleting a user message can orphan its reply.** This is the template's behaviour; Retry then has no question to replay and is hidden for that message. Fixing it would require a cascade rule the reference does not specify.
- **Two test files encode the previous decisions.** `playground-full-chat.test.js` is kept green by preserving its CSS contracts; the old spec is marked superseded rather than deleted.
