# Playground Redesign Specification

**Date:** 2026-10-30
**Route:** `/dashboard/playground`
**Reference:** `docs/templates/playground/main.html`, `docs/templates/playground/screen.png`
**Status:** Approved design, implementation plan pending

## 1. Context & Objectives

The current Playground (`src/app/(dashboard)/dashboard/playground/`) is a single chat workspace: model trigger, transcript, generation-settings popover, composer. It predates the redesign already shipped for `/dashboard`, `/dashboard/endpoint`, `/dashboard/providers` and `/dashboard/combos`, which share one language: page intro (`.title` / `.sub`), draggable `WidgetGrid` KPI cards in brand colours, and 24px-radius panels on `--surface` with `--line` hairlines.

This spec brings the Playground onto that language and turns it into a real routing workbench:

1. Page intro + three KPI cards (active target, cache/compression, routing pipeline).
2. Two-column workbench: chat session (left, fluid) and an execution rail (right, 360px) with generation parameters, route plan and last-response facts.
3. Three working view modes: **Single**, **Compare** (two models side by side), **JSON API** (raw request/response inspector).
4. A system-instructions card that is actually sent as `messages[0]`.
5. Full-height layout preserved: the page does not scroll, the transcript does.

Non-goals are listed in §11.

## 2. Design Principles

- **Real data only.** Every number shown comes from a documented fetch or from the response the user just received. Where the reference template invents gateway headers, upstream weights or per-request cost, this design shows the real field or omits it.
- **Config vs. observed.** Anything derived from combos/providers configuration is labelled as such; anything observed from a reply is labelled as reported by the upstream.
- **Smallest correct change.** Chat logic (payload shape, SSE parser, retry, stop, markdown, model catalog) is moved, not rewritten. No server change is required.
- **Existing components first.** `WidgetGrid`, `ModelPickerPopover`, `PlaygroundMarkdown`, `ProviderIcon`, `Icon`, `Tooltip`, `Button`, `useModelCatalog`, `useCopyToClipboard` are reused unchanged wherever possible.

## 3. Data Sources

All client-side; no new API route.

| Source | Used for |
| --- | --- |
| `GET /api/providers` | active connections, provider names/colours for picker and route plan |
| `GET /api/models/alias` | model aliases for the picker |
| `GET /api/keys` | first active key, used as `Bearer` for playground turns |
| `GET /api/combos` | combo chain (`models[]` in failover order) for route plan and combo detection |
| `GET /api/usage/stats?period=today` | cached prompt tokens, prompt tokens, cost total → Cache & compression card |
| `GET /api/settings` | `rtkEnabled`, `headroomEnabled` → token-saver status; `comboStrategies` for global fallback label |
| `POST /api/v1/chat/completions` | the turns themselves (streaming and non-streaming) |

Fetches run once on mount through one loader (existing pattern), each guarded: a failed fetch degrades its own surface only and never blocks the chat.

**Not available, therefore not shown:** per-request upstream provider, `x-jrouter-*` response headers, per-request cost, upstream weights/connection counts. `requestDetails` is observability-gated and is not used.

## 4. Layout

Full-height, no page scroll (`DashboardLayout` keeps `/dashboard/playground` in `isFullHeightPage` and `h-dvh`).

```
.playground        flex column, height 100%, padding 16px 32px 20px, gap 16px
├── .intro         title + subtitle | mode switch + Reset session
├── .stats         WidgetGrid, 3 widgets, rowHeight 128
└── .workbench     grid: minmax(0,1fr) 360px, gap 16px, min-height 0, flex 1
    ├── .chat      radius 24px, border 1px --line, bg --surface
    │   ├── header   model trigger, ctx pill, stream pill, actions
    │   ├── body     system card + transcript (flex 1, overflow-y auto)
    │   └── composer input + hints
    └── .rail      two cards stacked, overflow-y auto when short
```

Rules:

- `.intro` uses the endpoint/combos type scale: `clamp(28px, 3.4vw, 40px)`, weight 500, `letter-spacing: -0.05em`; subtitle 16px `--text-2`, max 60ch.
- Gap rhythm 16px; panel radius 24px; card padding 20–24px. No new colour tokens: `--surface`, `--surface-2`, `--line`, `--text*`, `--brand-*` only.
- Viewport height below 700px: `.workbench` gets `min-height: 480px` and the page becomes scrollable (`overflow-y: auto` on the page wrapper only in that media query) so the composer can never be pushed off-screen.
- Width below 1280px: `.workbench` becomes one column; the rail moves below the chat as a two-card row.
- Width below 640px: page padding 12px, KPI widgets stack, mode switch scrolls horizontally inside its own container.

## 5. KPI Cards

`PlaygroundStats` follows the `EndpointStats` implementation exactly: `WidgetGrid` with `ITEMS` (`activeTarget`, `cacheCompression`, `routingPipeline`), `defaultSpan: 2` each, layout persisted in `localStorage` key `jrouter.playground.statsLayout.v1`, plus the drag/reset footer. Deviation from the other pages: `rowHeight={128}` and values `clamp(22px, 2.2vw, 28px)` (compact variant) because this page's workbench must keep the viewport.

**Card 1 — Active target (pink `--brand-pink`, white text).**
Value: selected model's short name (text after the last `/`, capped at 28 characters), or `2 targets` in Compare. Note: provider name · `combo` or `direct` · status (`ready`, `streaming`, `idle`). Compare lists both names.
Unknown/empty state: `No target` + `Pick a model to start`.

**Card 2 — Cache & compression (lavender `--brand-lavender`).**
Value: `cached / prompt` percentage from `totalCachedTokens` and `totalPromptTokens` for `period=today` (0% when prompt is 0, capped at 100%). Note: `<n> cached tokens today` then a second line with token-saver status from `/api/settings`: `Token saver: RTK on · Headroom off`. Progress bar uses the same percentage.
Fetch failure: value `—`, note `Usage data unavailable`.

**Card 3 — Routing pipeline (ochre `--brand-ochre`).**
Value: `Combo chain` when the target resolves to a combo, `Direct` otherwise. Note: chain summary, e.g. `3 upstreams · river/deepseek → beatapi/… → custom/…` (the first three members, `+N` beyond), or `Single upstream · <provider>`. Footer micro-label: `from config` — this is the configured plan, not the upstream that served a reply.

## 6. Workbench — Chat Panel

**Header** (border-bottom, `--surface-2` tint):
- Model trigger: the existing `ModelPickerPopover` + `ProviderIcon` + name/provider, with `combo` badge. In Compare mode the header shows the focused lane's trigger and lane tabs; each lane has its own trigger inside its column header instead.
- Pills: `<n> ctx` when the catalog exposes a context window, else omitted; `SSE Stream` when `stream` is on, `JSON` when off; streaming state pill when a turn is in flight.
- Actions: copy cURL (masked key), toggle rail (icon, visible below 1280px), clear thread.

**System instructions card**: collapsible, collapsed by default, `textarea` bound to `systemPrompt`; token estimate shown only when the value is non-empty, computed as `Math.ceil(chars / 4)` and labelled `~n tokens`. When non-empty it is sent as `messages[0] = {role: "system", content}` for every lane and every turn; this is the one payload change.

**Transcript**: existing rendering preserved — user bubble right, assistant block left, reasoning accordion, markdown body, copy/retry actions, error bubble with Retry, `Model switched to …` dividers per lane. New per-message metric row replaces the old single meta line:

`TTFT <ms> · total <s> · <tok/s> · <in> in / <out> out · <finishReason> · <reported model>`

Values come from the turn: `firstTokenMs`, `totalMs`, `usage.completion_tokens / ((totalMs - firstTokenMs) / 1000)`, `usage`, `finish_reason`, chunk `model`. Missing values are omitted, never zero-filled.

**Composer**: unchanged behaviour (auto-grow to 200px, Enter sends, Shift+Enter newline). Adds the shortcut hint row on the right of the model/provider context chip. Attachment pills from the template are not implemented (§11).

## 7. Modes

Mode state lives on the page (`mode`), persisted in `localStorage` (`jrouter.playground.mode.v1`).

**Single** — one lane, identical to today's behaviour plus the chrome above.

**Compare** — two lanes (`a`, `b`) with independent model, transcript, streaming state, abort controller and metrics; one send broadcasts the same text to both lanes. Each lane renders its own column header (compact trigger + lane letter + status). Failures are per lane: one lane can error while the other streams. Rail parameters and system prompt are shared; the route plan card lists both lanes. Below 1100px the lanes become tabs (`Lane A` / `Lane B`) so each transcript stays readable.

**JSON API** — read-only inspector for the most recent completed turn across lanes (lane selector when both ran):
- *Request* tab: `POST /api/v1/chat/completions`, headers with `Authorization: Bearer …<last4>` masked, pretty-printed body.
- *Response* tab: status, `content-type`, streaming flag, frame count, elapsed, and the raw payload (SSE frames or JSON body), capped at 256 KB with a `truncated` note.
- *cURL* tab: reproducible command with `$JROUTER_API_KEY` as the credential.
Empty state before any turn: `Send a request to inspect it.`

To support this, each turn captures `request` (url, headers, body) and `response` (status, contentType, rawText, frames, durationMs) on the assistant message. The raw text is accumulated in the existing read loop; it is not re-fetched.

## 8. Rail

**Parameters card**
- Toggle `Use provider defaults`, ON by default. ON: no sampling params are sent (today's behaviour), sliders disabled and dimmed to 0.7 / 4096 / 0.95 placeholders. OFF: sliders are enabled.
- Temperature `0–2` step `0.05`; Max tokens `256–16384` step `256`; Top P `0–1` step `0.05`. Each row has a numeric input paired with the range input, both editable, clamped on blur.
- Toggles: `Stream responses` (default ON) and `Strict JSON` (default OFF, sends `response_format: {type: "json_object"}`).
- Token saver is **not** a playground toggle: a read-only line `Token saver: RTK on · Headroom off` links to `/dashboard/token-saver`.
- Footer: `Reset defaults` restores ON/`0.7`/`4096`/`0.95`, stream on, JSON off.

**Route plan card** — configured chain for the focused lane's target (both lanes in Compare), each row: order index, provider/model, `primary` / `fallback n` badge. Direct targets show one row plus `<n> connections` from `/api/providers`. Footer: `Route plan from config. The upstream that served a reply is shown per message.`

**Last response card** — status (`200 OK` / `error`), transport (`SSE` / `JSON`), TTFT, total, tokens in/out, finish reason, reported model, lane letter. Empty state: `No response yet.` This card is the honest replacement for the template's "Raw Gateway Response" header box.

## 9. Architecture

```
playground/
  PlaygroundPageClient.js      composition, mode, lanes, KPI data, fetches      ~380 lines
  usePlaygroundLane.js         per-lane engine: send/stop/retry/capture        ~330 lines
  PlaygroundStats.js           WidgetGrid KPI cards                              ~140 lines
  PlaygroundRail.js            parameters + route plan + last response         ~260 lines
  PlaygroundJsonView.js        JSON API inspector                              ~140 lines
  PlaygroundTranscript.js      message rendering (moved from client)          ~230 lines
  playgroundUtils.js           pure helpers (curl, mask, share, plan, metrics) ~110 lines
  playground.module.css        page/workbench/chat/rail styles                 full rewrite
  ModelPickerPopover.js        unchanged
  PlaygroundMarkdown.js        unchanged
  playground-markdown.module.css unchanged
  ModelPickerPopover.module.css unchanged
```

`usePlaygroundLane({ apiKey, systemPrompt, params })` returns:

```
{ model, setModel, messages, input, setInput, isStreaming,
  send(text), stop(), retry(messageId), clear(), lastTurn, lastError }
```

Rules:
- One `AbortController` per lane; `stop()` and `clear()` abort only that lane; unmount aborts all.
- `send` is a no-op while that lane is streaming; the page broadcasts to both lanes and disables the composer while any lane streams.
- Auto-follow transcript scrolling keeps the existing 80px bottom threshold, per lane.
- Payload builder takes `params` from a ref the page updates on render, so a slider change applies to the next send without stale closures; the provider-defaults toggle decides whether sampling fields are included, and the system message is prepended when non-empty.
- Switching a lane's model appends that lane's divider and keeps its transcript.

`playgroundUtils.js` (unit-tested): `buildCurl(request)`, `maskRequestHeaders(headers)`, `cacheShare(stats)`, `buildRoutePlan(target, combos, providers)`, `buildMetricParts(turn)`, `estimateTokens(text)`.

## 10. Error Handling, Accessibility, Responsive

- Lane errors stay in the lane (error bubble + Retry); the composer keeps the failed prompt for editing, as today.
- KPI fetches failing never block chat; each card has its own unavailable copy.
- JSON inspector renders error payloads and aborted turns; `truncated` marker above the cap.
- Mode switch is a `tablist` (`role="tab"`, `aria-selected`, arrow-key navigation); sliders and toggles are labelled; the rail toggle has `aria-expanded`; `focus-visible` uses the existing outline pattern; `prefers-reduced-motion` disables transitions.
- Tab order: intro controls → KPI reset → chat header → transcript → composer → rail.

## 11. Out of Scope

- Vision image, JSON-schema and tools attachment pills from the reference template.
- Per-request cost estimation and any pricing surface.
- Server-side `x-jrouter-*` response headers or exposing the actual upstream per request (candidate follow-up: additive headers in `open-sse/handlers/chatCore/streamingHandler.js`).
- Session persistence, share links, prompt library, export of transcripts.
- Changes to the dashboard shell (`Sidebar`, `Header`, layout wrapper) — the existing shell already matches the reference.
- Editing `docs/templates/**`.

## 12. Testing & Verification

**Automated**
- `tests/unit/playground-utils.test.js` (new): `cacheShare` (zero/partial/full/over), `buildRoutePlan` (combo order, direct, unknown target, missing combos), `maskRequestHeaders` (bearer masked, no key leaked), `buildCurl` (method/path/body, `$JROUTER_API_KEY`), `buildMetricParts` (missing usage yields no `NaN`), `estimateTokens`.
- `tests/unit/playground-full-chat.test.js` (updated): the "no page header" assertions are superseded — assert the intro exists, KPI section exists, three modes exist, `DashboardLayout` still keeps `h-dvh` and the full-height classes, and the mobile composer caps remain.
- `npx eslint` on every touched file.

**Manual (dev server, port 20128, `DATA_DIR=%APPDATA%\jrouter`)**
- Single streaming turn: metrics row populates with TTFT/tok-s/tokens; stop mid-stream; retry.
- Non-streaming (`Stream responses` off): JSON branch renders, rail shows transport `JSON`.
- Compare with one valid and one invalid model: one lane streams, the other shows an isolated error.
- JSON API mode: request/response/cURL tabs for a real turn; masked key; truncation note on a long reply.
- KPI cards: percentages match `/api/usage/stats?period=today`; token-saver line matches `/api/settings`; routing card matches the combo chain in `/dashboard/combos`.
- Layout at 1440×900, 1280×800, 390×844 and 1024×500 (short landscape): no clipped composer, rail stacks correctly, no page scrollbar except the <700px fallback.
- `npm run build` in the background (repo-wide lock, 15–20 min expected) before declaring done.

## 13. Risks

- **Compare doubles request volume.** Broadcast sends two requests per prompt; by design, and the composer disables while any lane streams.
- **JSON capture memory.** Raw payloads are capped at 256 KB per turn; the transcript keeps at most the existing in-memory messages, so memory stays bounded by conversation length.
- **KPI card height on short laptops.** Mitigated by the compact widget height and the <700px scroll fallback; verified in the manual matrix.
- **Existing tests encode the old "no header" decision.** Update them deliberately in the same change and note the supersession in the commit message.
