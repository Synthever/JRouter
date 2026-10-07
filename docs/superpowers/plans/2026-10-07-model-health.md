# Model Health Implementation Plan

**Goal:** Implement the supplied Model Health brief end to end at `/dashboard/health`.
**Architecture:** Existing SQLite adapters and additive schema synchronization; shared chatCore inference pipeline; authenticated dashboard API; server scheduler with expiring database leases. Scheduled probes are opt-in, manual checks remain independent. Production routing is unchanged.
**Tech stack:** JavaScript, Next.js, React, SQLite, existing dashboard components.
**Spec:** User-supplied 37-section Model Health request.

## Constraints and decisions

- Reuse dashboard surface, border, radius, typography and status tokens because this is an existing operational page. ENERGY 1 / RHYTHM 1 / MOTION 1; table is the focal point, status color conveys measured health.
- Use chat models from the existing catalog, restricted to active configured providers. Skip live catalog fetches on health refresh; custom/explicit models participate.
- Probes use a tiny real inference through chatCore with cancellation, no inference retry, no request-body/response logging, and no production routing fallback.
- Record provider connection ID as apiKeyId (credential reference only), with generated safe key names.
- Use 24-hour SQL aggregates for metrics, fixed server-side timeline buckets, and paginated check history.
- Database leases coordinate model checks, a three-slot global concurrency budget, batch execution and scheduled ticks. Native SQLite shares locks across processes on the same database; sql.js is single-process only, as is the existing database fallback.
- Add passive-signal ingestion separately; only active probes affect authoritative status. Expose routing health and Combo member lookup foundations.
- Clean up checks older than 30 days during scheduler maintenance.

## Implementation and verification

- [ ] Write failing tests for thresholds, classification, metrics, configuration, persistence and leases.
- [ ] Add schema version, repository, provider probe and health service; verify behavioral tests.
- [ ] Add protected summary/list/detail/history/config/check/check-all API and server scheduler.
- [ ] Build reusable summary, timeline, table, drawer, history and settings using existing controls; add navigation.
- [ ] Verify authorization, streaming progress, cost limits, sanitization and empty/error states.
- [ ] Run relevant regression tests, lint, production build, and browser checks at desktop/mobile in both themes.
- [ ] Document endpoints, automatic migration, scheduler operation, driver/deployment limits and extension APIs.
