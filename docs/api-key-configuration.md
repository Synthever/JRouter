# Per-API-Key Configuration

Open **Endpoint & Key → Configure** beside a key. Settings apply to the same credential immediately; saving never regenerates it. Existing keys retain unlimited quotas and rates, multiplier 1, no expiration, and access to every supported endpoint and model.

Empty numeric limits mean unlimited. Token and USD quotas may be zero to deny usage. Output caps and RPM/TPM must be positive integers; the billing multiplier must be greater than zero.

Quota periods follow UTC calendar boundaries: hourly, daily, Monday-start weekly, monthly, or lifetime. Counters reset lazily on use. Changing unrelated settings preserves usage. Expiration is entered in the browser's local timezone and stored in UTC.

Token quotas count input plus output, multiplied by the key's billing multiplier. The same multiplier applies to calculated cost. Analytics retain their existing raw token counts, and TPM uses raw tokens. Provider requests and responses are not scaled by the multiplier.

Requests reserve estimated capacity in SQLite before forwarding, including other in-flight reservations. The shared token estimator and requested output limit determine admission; uncapped chat requests reserve an estimated 4,096 output tokens. A small quota or TPM budget may require an explicit output limit. Completion and cancellation reconcile actual usage, including SSE streams. Failed requests release unused quota reservations but still count toward RPM. Reservations abandoned for 30 minutes are conservatively charged against their estimate on the next use.

Cost quotas require known model pricing. Missing pricing produces `pricing_unavailable`; configure pricing or remove the cost quota. Requests without a cost quota keep the existing zero-cost fallback. Admission estimates are approximate, so actual usage may exceed an estimate and is always recorded.

Allowed models use the same searchable picker as combo creation. An empty whitelist allows all models, and blocked models take priority. Server settings also accept `*` patterns. Alias resolution, combo members, and capacity adapters are checked before forwarding. Selecting a combo grants access to its members except those explicitly blocked. Model discovery filters supplied key credentials by model access and rejects expired keys.

Endpoint permissions cover supported Chat/Responses, Embeddings, Images, Audio, Web/Search, Videos, and SystemOne routes. Unchecking every family denies inference. An unrestricted key automatically includes families added in future releases.

## Settings API

Dashboard administrator authentication is required. Gateway bearer credentials do not authorize management.

- `GET /api/keys?view=settings` lists sanitized settings.
- `GET /api/keys/:id` reads sanitized settings and usage.
- `PATCH /api/keys/:id` updates settings; `PUT` remains supported.
- `GET /api/keys/:id/secret` supports the explicit Copy action.

Settings responses include a masked `keyPrefix`, never `key` or `machineId`. Existing credential setup integrations retain their authorized list/create behavior. The configuration UI stores only sanitized key data; Copy retrieves a credential transiently for the clipboard.

Supported PATCH fields are `name`, `description`, `isActive`, `maxTokensQuota`, `maxCostUsd`, `quotaResetCycle`, `tokenMultiplier`, `maxOutputTokens`, `rateLimitRpm`, `rateLimitTpm`, `expiresAt`, `allowedModels`, `blockedModels`, and `allowedEndpoints`. `expiresAt` accepts an ISO datetime with a timezone or `null`. `allowedEndpoints: null` means unrestricted; `[]` denies every inference family. Model lists use `[]` for their unrestricted/empty default.

Rejected requests return the existing OpenAI-compatible error envelope with codes such as `api_key_expired`, `model_not_allowed`, `endpoint_not_allowed`, `quota_exceeded`, `cost_quota_exceeded`, `rate_limit_exceeded`, `token_rate_limit_exceeded`, and `max_output_tokens_exceeded`. Rate denials include `Retry-After`.

## Storage

Migration 002 adds policy and counter columns and an admission ledger to the existing database. It preserves IDs, secrets, and active state. Admission uses a SQLite writer transaction and internal key IDs, shared across workers using the same database file. Separate hosts need a shared database/limiter to share budgets; JRouter has no Redis limiter to reuse.
