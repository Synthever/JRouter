# JRouter — AI Router & Token Saver

**One endpoint for every model. Automatic failover, fewer tokens, full control.**

JRouter is a self-hosted AI gateway with a dashboard. It exposes a single OpenAI/Claude-compatible
endpoint at `http://localhost:20128/v1` and routes each request across 140+ providers, translating
between wire formats and keeping the request alive when a provider is slow, rate-limited or out of quota.

[![npm](https://img.shields.io/npm/v/@synthever/jrouter.svg)](https://www.npmjs.com/package/@synthever/jrouter)
[![Downloads](https://img.shields.io/npm/dm/@synthever/jrouter.svg)](https://www.npmjs.com/package/@synthever/jrouter)
[![License](https://img.shields.io/npm/l/@synthever/jrouter.svg)](https://github.com/Synthever/JRouter/blob/master/LICENSE)
[![Node](https://img.shields.io/node/v/@synthever/jrouter.svg)](https://www.npmjs.com/package/@synthever/jrouter)

---

## Quick start

```bash
npm install -g @synthever/jrouter
jrouter
```

- Dashboard: `http://localhost:20128/dashboard`
- Endpoint: `http://localhost:20128/v1`
- Data: `~/.jrouter` (`%APPDATA%\jrouter` on Windows)

Then point any OpenAI/Claude-compatible tool at it:

```
Base URL: http://localhost:20128/v1
API key:  [create one in the dashboard]
Model:    <provider>/<model>
```

That's it — providers, keys and routing are all managed from the dashboard.

---

## Why JRouter

### Routing that doesn't stop mid-task

- **Move-on-error key demotion.** A failing key is flagged and sorted behind every healthy key for
  that provider until its next successful call clears the flag. Your curated priority order is never
  rewritten — it's a runtime overlay, so a recovered key returns to its original slot. Per-provider
  toggle, on by default. Payload-caused 4xx errors (400, 404, 413, 422, …) never demote: the
  credential isn't the problem.
- **Sequential pool round-robin.** Strict `1 → 2 → 3 → 1` rotation over a configurable pool window,
  demotion-aware: a demoted key sinks out of the window and a recovered key re-enters at its curated
  position. The cursor is identity-based, so changing pool membership re-anchors instead of skipping a key.
- **Three combo strategies.** `fallback` (chain), `round-robin` (rotate members), and `fusion` —
  every panel model answers in parallel and a judge model synthesizes the final answer, with a
  quorum grace window so one slow panelist can't stall the request.
- **Capacity-aware routing.** Requests that need image/audio/video input only land on models that
  actually accept those modalities, instead of failing upstream.
- **Model Health dashboard.** Per-model availability timeline, rolling success data, single and
  batch probes, and a drill-down with the last failure detail — so you see *which* model is degraded
  before your tools do.

### Token economy

- **RTK token saver.** Compresses `tool_result` payloads (git diffs, grep/ls output, file dumps)
  in place before translation — agent traffic stops paying full price for noise it never reads.
  Fail-open by design: on any error the body is left untouched, and error traces are never compressed.
- **Quota tracking.** See remaining subscription quota per account and use it before it resets.
- **Throughput and latency KPIs.** Requests/min, tokens/min and latency percentiles persisted into
  daily summaries, so history survives restarts instead of resetting with the process.

### Control and operations

- **Per-API-key policy.** Token and cost quotas with hourly/daily/weekly/monthly/lifetime reset
  windows, RPM/TPM limits, expiry, billing multiplier, model allow/block lists and endpoint-family
  permissions (chat, embeddings, images, audio, video, web). Requests are admitted against a SQLite
  reservation ledger, so concurrent in-flight calls can't overshoot a budget.
- **Proxy pools.** Named pools with per-connection assignment, no-proxy lists, strict mode, bulk
  import and relay presets for Vercel / Cloudflare / Deno / Netlify.
- **Key operations at scale.** Extract all keys of a provider as JSON, bulk-import them on any other
  provider, and test connections one by one from the provider header.
- **Usage analytics.** Requests, tokens (input/cached/output) and cost per provider over time,
  with a playground to try any connected model instantly.
- **Custom providers.** Any OpenAI-compatible endpoint can be registered as its own node, with a
  pinned context window and max output per model, plus persistence of per-provider disabled models
  across backup/restore.

### Built to be operated

- **Format translation, not just proxying.** OpenAI Chat/Responses, Claude Messages, Gemini, Vertex,
  Codex, Antigravity, Kiro, Cursor, Ollama and CommandCode shapes are translated natively, with
  direct routes for fragile pairs (thinking blocks, tool ids, non-base64 images) that would be lossy
  through an OpenAI pivot.
- **Crash-safe state.** SQLite with an adapter fallback chain (`bun:sqlite` → `better-sqlite3` →
  `node:sqlite` → `sql.js`), so there is always a working driver with no native build step.
- **Real client IPs behind a proxy.** The bundled server derives the socket IP and strips spoofed
  `X-Forwarded-For`, trusting forwarding headers only from a loopback reverse proxy.

---

## CLI

```bash
jrouter                     # start (default port 20128, opens the browser)
jrouter --port 8080         # custom port
jrouter --host 127.0.0.1    # bind local-only
jrouter --no-browser        # don't open the browser
jrouter --log               # stream server logs
jrouter --tray              # run in the system tray
jrouter --skip-update       # skip the update check
jrouter --help              # all options
```

### Connect a remote server

Point this machine's CLI tools at a JRouter running somewhere else — no local server started:

```bash
npx @synthever/jrouter connect http://<server-host>:20128                        # pick tools interactively
npx @synthever/jrouter connect http://<server-host>:20128 --tools claude,codex   # or choose up front
npx @synthever/jrouter connect --reset --tools claude,codex                      # undo
```

It logs in with the dashboard password (hidden prompt), reuses or creates an API key named
`cli-<hostname>`, and writes each tool's config, backing up the original once as `*.bak-jrouter`.

Supported tools: `claude`, `codex`, `opencode`, `droid`, `crush`, `kilo`, `cline`, `pi`, `omp`, or `all`.
Models come from the server's own CLI-tools configuration, so a client gets whatever the operator
already picked — nothing is hardcoded. Override per run with `--opus/--sonnet/--haiku/--fable` for
Claude and `--model` for the rest.

### Inspect the current setup

```bash
jrouter show                 # every supported tool
jrouter show claude          # one tool
jrouter show claude --json   # machine-readable (key still masked)
```

`show` reads local files only, printing base URL, masked key and models for each tool, and flags a
tool that still points at another provider.

### Video generation

```bash
jrouter xai video --prompt "a cat surfing" --output video.mp4
```

Runs against the already-running gateway using your Grok Imagine credentials.

---

## Providers

140+ integrations out of the box: Anthropic, OpenAI, Gemini/Vertex, AWS Bedrock, Azure, Groq,
Cerebras, DeepSeek, Mistral, xAI, OpenRouter, Together, Fireworks, NVIDIA, Nebius, SambaNova,
Cloudflare AI, Hugging Face, Ollama (local), plus subscription and OAuth-based tools
(Claude Code, Codex, Antigravity, Kiro, Cursor, Copilot, Kilo, WorkBuddy, OpenCode) and free tiers
such as BeatAPI, OpenCode Free and Kiro.

Beyond chat, the same endpoint families cover embeddings, image generation, video, TTS, STT,
and web search/fetch.

Any tool that speaks OpenAI or Claude is supported. Anything else can be added as a custom
OpenAI-compatible node.

---

## Development

```bash
git clone git@github.com:Synthever/JRouter.git && cd JRouter
npm install
PORT=20128 npm run dev          # dashboard + gateway

cd cli && npm install && npm run build   # build the CLI bundle into cli/app
```

The dashboard/gateway and the CLI are versioned independently. See `CHANGELOG.md` in `cli/`.

---

## Credits & license

JRouter builds on the open-source 9Router architecture by [decolua](https://github.com/decolua),
which in turn credits [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). Those projects
remain under their original MIT terms; JRouter's own changes are released under the same license.

MIT — see [LICENSE](https://github.com/Synthever/JRouter/blob/master/LICENSE).
