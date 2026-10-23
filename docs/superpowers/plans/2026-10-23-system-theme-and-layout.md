# System Theme and Browser Layout Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated ownership and review. No commits, pushes or deployment are authorized.

**Goal:** Apply the approved docs/DESIGN.md theme across JRouter and retain bento order/spans across browser reload.

**Architecture:** Preserve the existing Next App Router, CSS tokens, shared components and theme persistence. Replace the global foundation and hardcoded surface exceptions with the approved cream/full-color palette and dark-teal adaptation. Browser layout persistence remains owned by the KPI consumer; reusable grid publishes completed gestures separately from live previews.

**Tech Stack:** JavaScript, Next.js, React, Tailwind v4, CSS modules, Motion, Vitest.

**Spec:** docs/DESIGN.md plus user approval in this conversation: entire system, full palette including lavender; retain light/dark/system with dark-teal adaptation; preserve the approved bento.

## Global Constraints
- Keep existing uncommitted bento work and docs/DESIGN.md contents.
- No routing/authentication/provider transport/credential/data-model changes.
- Do not copy GTM/CRM marketing claims from design reference; retain real JRouter content.
- No new mascot/illustration assets or paid font requirements. Inter 500 is the document's permitted Plain Black substitute.
- Full approved palette overrides skill palette restrictions. Text contrast still meets WCAG AA.
- Preserve theme storage key, prepaint script, system-mode behavior and mobile controls.
- No source-rewriting scripts. Use direct file edits. No dependency/framework migration.
- Run app/build with isolated DATA_DIR/HOME and NEXT_DIST_DIR, startup suppressed. Do not mint active-instance sessions or touch active credentials.
- Evidence: .taste-skill/system-theme/; existing prior evidence stays intact.

## Ownership and interfaces
1. Foundation (parent): src/app/globals.css and src/app/layout.js only. Publish --brand-pink/teal/lavender/peach/ochre/mint/coral, --canvas/--surface-soft/--surface-card/--surface-strong, --font-ui/--font-display; preserve old semantic aliases. Light cream, dark teal. Inter loaded once with next/font.
2. Persistence worker: src/shared/components/ui/bento-grid.js; src/app/(dashboard)/dashboard/components/KpiBentoGrid.js; focused persistence helper/tests. Grid onLayoutChange previews; optional onLayoutCommit(next) publishes accepted gestures. No CSS changes.
3. Shared/public worker: shared components except bento-grid.js and theme mechanism; landing/login/callback/pricing route, OAuth HTML CSS templates only. Consume foundation tokens, no globals edits and no auth/session logic changes.
4. Product surface worker: dashboard route components/CSS except KPI JS; shared bento CSS. Full palette cards, token-aware charts/code/forms, maintain semantics and behaviors.

## Task 1: Foundation theme
- [ ] Read installed Next font docs and current token declarations.
- [ ] Capture baseline token values and source hashes under evidence dir.
- [ ] Add failing semantic theme tests for approved palette + Inter wiring.
- [ ] Replace base values, retain aliases; remove old global glass/gradient/heavy shadow styling; preserve focus/status readability.
- [ ] Verify token/contrast tests and changed-file lint.

## Task 2: Persistent bento
- [ ] Add failing tests for malformed storage, accepted gesture save and reset.
- [ ] Restore once after mount with guarded localStorage access; never initial default save before restore.
- [ ] Persist canonical {id,span}[] under jrouter.dashboard.kpiLayout.v1 after accepted gestures only.
- [ ] Cancel restores snapshot without writing; pointer resize Escape/pointercancel rolls back. Unmount cannot publish a commit.
- [ ] Reset clears only own key and remounts gesture state; storage failure leaves in-memory functionality.
- [ ] Verify focused tests and real browser reorder/resize/reload/reset/cancel.

## Task 3: Shared and public surfaces
- [ ] Inspect existing components and record hardcoded color exceptions.
- [ ] Apply token-backed button/input/dialog/shell variants; preserve semantic status and third-party branding.
- [ ] Remove forced-dark landing island and black shader/frosted footer; apply cream/full-palette public design with existing real content.
- [ ] Theme standalone callback HTML without changing its escape/auth/session code.
- [ ] Lint all edited JS; verify login, landing, callback, modal, theme toggle and sidebar at desktop/mobile.

## Task 4: Product screens
- [ ] Inspect route-local modules and hardcoded exceptions.
- [ ] Replace old at-rest glass and mono display labels with product typography and approved panels.
- [ ] Map KPI cards to stable palette roles using widget identity, not reorder position; preserve status colors.
- [ ] Theme chart series explicitly and code/editor surfaces for both themes; preserve functional tables/forms.
- [ ] Lint edits and run affected tests, compare existing failures against original base.

## Task 5: Integration and verification
- [ ] Review complete diff for auth/credential/header changes (none intended), stale tokens, missing routes and conflicting selectors.
- [ ] Run focused Vitest and existing adjacent tests; do not claim full known-red suite green.
- [ ] Build isolated artifact with NEXT_DIST_DIR=.next-system-theme and bootstrap preload.
- [ ] Run isolated preview through custom-server.js, normal test-password login, browser route sweep and real interaction checks.
- [ ] Screenshot 1440/768/390, both themes; inspect full actual pages, contrast and overflow. No hidden scope used to claim whole-system success.
- [ ] Record outcomes, gate and limitations. Stop owned preview process. Leave source unstaged.
