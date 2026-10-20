# Publishing the JRouter CLI to npm

The CLI launcher (`cli/`) is published separately from the dashboard app as
[`@synthever/jrouter`](https://www.npmjs.com/package/@synthever/jrouter). The
dashboard itself is never published — only the package that installs and runs it.

Everything below runs from a checkout of this repo. `cli/scripts/release-cli.js`
is the single entry point; do not bump versions or tag by hand.

## What gets published

`cli/package.json` declares `files: ["cli.js", "src", "hooks", "app", "README.md", "LICENSE"]`.

- `cli/src/**` is shipped **verbatim**, not bundled. A new menu or command is
  live in the next publish without any build step touching it.
- `cli/app/` is the Next.js standalone server, built into the package by
  `npm run build` (`scripts/build-cli.js`). It is the bulk of the ~13 MB tarball.
- `prepublishOnly` re-runs the build, so a stale `cli/app` cannot ship — but it
  also means `npm publish` takes as long as a full build.

## Prerequisites

```bash
node --version            # >= 18 (the package declares engines.node)
npm whoami                # must print your npm account, not E401
```

If `npm whoami` returns `E401 Unauthorized`, the stored token expired. Log in
again from inside `cli/` before anything else:

```bash
cd cli && npm login
```

The repo tree must be **clean**, including untracked files. `release-cli.js`
aborts on any `git status --porcelain` output:

```
✗ Git tree is dirty — commit or stash first:
?? some-scratch-file.md
```

A concurrent agent's leftover file is enough to block a release. Commit it,
stash it, or move it out of the tree.

## The one-command release

```bash
cd cli
node scripts/release-cli.js patch     # 1.0.5 → 1.0.6
node scripts/release-cli.js minor     # 1.0.5 → 1.1.0
node scripts/release-cli.js major     # 1.0.5 → 2.0.0
```

Useful variants:

```bash
node scripts/release-cli.js --dry-run                # print the plan, change nothing
node scripts/release-cli.js --no-publish             # build + pack + tag, skip the registry
node scripts/release-cli.js patch 1.2.3              # explicit version
```

### What the script does

| Step | Action |
| --- | --- |
| 0 | Assert repo root, clean tree, and a logged-in npm account |
| 1 | Collect commits since the last `cli-v*` tag into a changelog entry |
| 2 | `npm version <bump>` in `cli/`, then restore the root `package.json` (npm walks up and would bump it too) |
| 3 | Build the Next standalone app into `cli/app` |
| 4 | `npm pack` to `/tmp` and fail if the tarball exceeds 60 MB |
| 5 | `npm publish` (skipped with `--no-publish`) |
| 6 | Commit `cli/package.json`, `package-lock.json`, `cli/CHANGELOG.md`, tag `cli-v<version>`, push with `--follow-tags` |
| 7 | Poll `npm view` until the registry serves the new version |

Step 6 pushes **the whole branch**, not just the release commit. Anything else
sitting unpushed on `master` goes with it.

## When `npm publish` fails with EOTP

The `synthever` npm account enforces 2FA, and this VPS is headless. The script
runs steps 0–4 fine and then dies at step 5:

```
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
```

Steps 1–2 already mutated `package.json` and `CHANGELOG.md`, and step 3 already
built `cli/app`. Do **not** re-run the script — finish the release by hand.

**1. Publish from an interactive terminal.** The TTY is what makes npm print the
real web-auth URL; piping the output through `tee` or a pipe yields a redacted
`***` link that 404s.

```bash
cd cli
npm publish --ignore-scripts     # --ignore-scripts: the tarball is already built
```

Open the `https://www.npmjs.com/auth/cli/<uuid>` URL it prints and approve it.
**That window expires within minutes** — if the waiting publish poll fails with
`E404`, just run the command again for a fresh URL. The tarball does not change,
so retrying is always safe.

**2. Finish the git side.** `npm publish` does not commit or tag:

```bash
cd ..                                   # repo root
git add cli/package.json cli/CHANGELOG.md cli/app
git commit -m "chore(cli): release <version>"
git tag "cli-v<version>"
git push origin master --follow-tags
```

## Verifying a publish

Registry propagation is not instant — `dist-tags.latest` can still show the old
version for a few minutes after npm prints `+ @synthever/jrouter@<version>`.

```bash
npm view @synthever/jrouter version
npm view @synthever/jrouter dist-tags
```

Then prove the tarball matches what you built and that it actually installs:

```bash
cd cli
npm pack --json --pack-destination /tmp        # prints shasum, size, entryCount
npm view @synthever/jrouter@<version> dist.shasum
```

The two shasums must be identical. Finally, install the published package into a
throwaway prefix and assert the installed version:

```bash
PREFIX="$(mktemp -d)"
npm i -g --prefix "$PREFIX" --ignore-scripts @synthever/jrouter@<version>
"$PREFIX/bin/jrouter" --version          # must print <version>
```

`$PREFIX/bin/jrouter` is a symlink into `lib/node_modules`, so `find -type f`
will not locate it — call the path directly.

To confirm a specific change actually shipped, read it out of the installed tree:

```bash
node -e "console.log(require('$PREFIX/lib/node_modules/@synthever/jrouter/package.json').version)"
```

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Git tree is dirty` | Uncommitted or untracked file anywhere in the repo | Commit, stash, or move it |
| `Not logged in to npm` / `E401` | Expired npm token | `cd cli && npm login` |
| `EOTP` | 2FA required, headless shell | Publish from a TTY (see above) |
| `E404` during the auth poll | Auth URL expired | Re-run `npm publish` for a fresh URL |
| `tarball > 60MB` | Bloated `cli/app` bundle | Inspect `cli/app`, rebuild before publishing |
| `dist-tags.latest` still old | Registry propagation lag | Wait 2–5 minutes, poll again |

## Rolling back a publish

npm does not allow republishing an existing version. To undo a bad release:

```bash
npm deprecate @synthever/jrouter@<version> "reason"
```

Then publish a follow-up patch with the fix. `npm unpublish` is reserved for
secrets exposed in the tarball — it creates a permanent gap downstream consumers
cannot resolve, so prefer deprecate + patch for anything else.
