# Playground layout correction plan

**Goal:** Align the existing Playground toolbar, transcript, generating/thinking states, and composer on one centered 920px grid without changing their visual design or chat logic.

**Architecture:** Keep the dashboard shell unchanged. The route uses its existing full-height shell, adds a flex workspace, and shares one content-width class across the toolbar, transcript, and composer area. Conversation content owns vertical scrolling; existing near-bottom auto-follow remains in place.

**Tech stack:** Next.js, React, CSS Modules, existing Playground components.

**Spec:** User's supplied Playground geometry/layout correction brief, 2026-10-06.

**Latest user direction:** Replace the centered 920px limit with the full dashboard content width. Give the chat workspace a shared background container and make the bottom composer full-width. This supersedes the earlier width and background constraints below; chat behavior and conversation-only scrolling remain required.

## Constraints

- Preserve the sidebar, navbar, grid background, colors, typography, picker, bubbles, thinking/generating components, and composer appearance.
- Preserve request payloads, streaming parser, model selection, metadata, retry, stop, and New Chat handlers.
- Keep the transcript naturally sized; keep toolbar/composer stationary while it scrolls.
- Use 24px gutters at medium widths and 12px at small widths; keep a readable assistant body and right-aligned user bubbles.

## Review focus

- Long streamed responses: only the transcript scrolls and composer geometry stays stable.
- User scrolls upward during a stream: existing near-bottom behavior must not pull the reader down.
- Narrow or short viewports: controls remain reachable without page overflow.
- Open model/settings popovers: existing layout and interactions remain usable.
- New Chat/model switching: existing reset and divider behavior remains intact.

## Tasks

- [x] Measure baseline toolbar, transcript content, composer bounds, and empty-state position at 1920x1080.
- [x] Add the shared column and workspace wrappers; update only route geometry/spacing styles.
- [x] Use local response fixtures to observe generating, thinking, long streaming, stop, and scrolling without touching account data or calling providers.
- [x] Verify the shared edges, message rhythm, composer bottom spacing, fixed toolbar/composer, and manual-scroll behavior at desktop and narrow widths.
- [x] Check the source diff for preserved logic, run targeted lint and development compilation, and record results.

## Execution notes

- Baseline: toolbar/canvas outer width 860px with 32px internal horizontal padding; composer width 860px without those gutters. This produces a 32px mismatch at each content edge.
- Baseline: the empty-state flex growth and end alignment put its content near the composer instead of near the transcript top.
- The shell already supplies the available viewport height and the existing auto-follow tracks an 80px bottom threshold. Reuse both rather than introducing another height constant or scroll utility.
- The small-screen browser check found the model popover extending below the viewport. Its existing contents now shrink into the measured available height; picker appearance and catalog behavior remain unchanged.
