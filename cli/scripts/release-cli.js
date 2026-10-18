#!/usr/bin/env node
// One-command release for the @synthever/jrouter CLI package.
//
//   node scripts/release-cli.js            # patch bump (default)
//   node scripts/release-cli.js minor|major|patch <optional version>
//   node scripts/release-cli.js --no-publish   # build + pack, skip npm publish
//   node scripts/release-cli.js --dry-run      # show plan, change nothing
//
// Steps:
//   0. Sanity: clean git tree (required), correct repo root, npm logged in
//   1. Aggregate upstream/repo commits into cli/CHANGELOG.md
//   2. npm version <bump> (updates package.json + git tag)
//   3. Build the Next standalone app into cli/app (root npm install if needed)
//   4. npm pack → size + tarball sanity
//   5. npm publish (unless --no-publish) with explicit OTP window
//   6. Push commits + tags; verify registry serves the new version
"use strict";

const { execSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CLI_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = path.resolve(CLI_DIR, "..");
const PKG_NAME = "@synthever/jrouter";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPublish = args.includes("--no-publish");
const bump = args.find((a) => ["patch", "minor", "major"].includes(a)) || "patch";

const say = (m) => console.log(`\x1b[1m▸\x1b[0m ${m}`);
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const die = (m) => {
  console.error(`\x1b[31m✗ ${m}\x1b[0m`);
  process.exit(1);
};
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: opts.quiet ? "pipe" : "inherit", cwd: opts.cwd || CLI_DIR, ...opts });

function step(msg, fn) {
  say(msg);
  if (dryRun) return undefined;
  return fn();
}

// ── 0. Sanity ──────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(ROOT_DIR, "src")) || !fs.existsSync(path.join(CLI_DIR, "cli.js"))) {
  die("Run this from the JRouter repo (cli/scripts/release-cli.js not in a checkout?)");
}
sh("git rev-parse --is-inside-work-tree", { quiet: true, cwd: ROOT_DIR });
const dirty = execSync("git status --porcelain", { cwd: ROOT_DIR, encoding: "utf8" }).trim();
if (dirty) die(`Git tree is dirty — commit or stash first:\n${dirty.split("\n").slice(0, 8).join("\n")}`);
ok(`Git tree clean @ ${execSync("git rev-parse --short HEAD", { cwd: ROOT_DIR, encoding: "utf8" }).trim()}`);

let npmWho = "";
try { npmWho = execSync("npm whoami", { encoding: "utf8", cwd: CLI_DIR }).trim(); } catch {}
if (!npmWho) die("Not logged in to npm — run `npm login` inside cli/ first.");
ok(`npm: ${npmWho}`);

const branch = execSync("git branch --show-current", { cwd: ROOT_DIR, encoding: "utf8" }).trim();
if (branch !== "master") say(`⚠ on branch "${branch}" (not master) — continuing, tag will point here`);

// ── 1. Changelog (commits since last cli version tag) ──────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(CLI_DIR, "package.json"), "utf8"));
const oldV = pkg.version;
let changelogNotes = "";
try {
  const since = execSync(`git describe --tags --abbrev=0 --match="cli-v*"`, { cwd: CLI_DIR, encoding: "utf8" }).trim();
  const log = execSync(`git log ${since}..HEAD --oneline -- cli/ src/ open-sse/ package.json`, { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  changelogNotes = log.split("\n").slice(0, 12).map((l) => `- ${l}`).join("\n");
} catch {
  changelogNotes = "- (no previous cli-v tag found)";
}
const changelogPath = path.join(CLI_DIR, "CHANGELOG.md");
const stamp = new Date().toISOString().slice(0, 10);
const prevChangelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "# Changelog\n";
step(`Changelog entry prepared for v${oldV} → next ${bump}`);
console.log(`\n${changelogNotes || "- (no repo changes in scope)"}\n`);

// ── 2. Version bump ────────────────────────────────────────────────────
step(`npm version ${bump}`);
if (!dryRun) {
  sh(`npm version ${bump} --no-git-tag-version`, { cwd: CLI_DIR });
}
const newV = dryRun ? "(dry)" : JSON.parse(fs.readFileSync(path.join(CLI_DIR, "package.json"), "utf8")).version;
ok(`${PKG_NAME} ${oldV} → ${newV}`);
if (!dryRun) {
  const header = prevChangelog.startsWith("# Changelog") ? "" : "# Changelog\n\nAll notable changes to the `@synthever/jrouter` CLI package.\n\n";
  const entry = `## cli-v${newV} (${stamp})\n\n${changelogNotes || "- (no repo changes in scope)"}\n\n`;
  fs.writeFileSync(changelogPath, header + entry + prevChangelog.replace(/^# Changelog\n\n(All notable[^\n]*\n\n)?/, ""));
}

// ── 3. Build the app bundle into cli/app ───────────────────────────────
step("Build Next standalone → cli/app (root npm install + build)");
if (!dryRun) {
  const hasAws = fs.existsSync(path.join(ROOT_DIR, "node_modules/@aws-sdk/credential-providers"));
  if (!hasAws) {
    say("  root deps missing (@aws-sdk) → npm install…");
    sh("npm install --no-audit --no-fund", { cwd: ROOT_DIR });
  }
  const hasEsbuild = fs.existsSync(path.join(CLI_DIR, "node_modules/esbuild"));
  if (!hasEsbuild) {
    say("  cli deps missing (esbuild) → npm install…");
    sh("npm install --no-audit --no-fund", { cwd: CLI_DIR });
  }
  sh("npm run --prefix . build", { cwd: CLI_DIR });
}
ok("app bundle built");

// ── 4. Pack sanity ─────────────────────────────────────────────────────
step("npm pack →Sanity check");
if (!dryRun) {
  sh("rm -f /tmp/synthever-jrouter-latest.tgz");
  sh("npm pack --pack-destination /tmp");
  const tgz = `/tmp/${PKG_NAME.replace("/", "-")}-${newV}.tgz`;
  if (!fs.existsSync(tgz)) die(`pack failed — ${tgz} not found`);
  const stat = fs.statSync(tgz);
  ok(`tarball ${(stat.size / 1024 / 1024).toFixed(1)}MB → ${tgz}`);
  if (stat.size > 60 * 1024 * 1024) die("tarball > 60MB — check the app bundle for bloat");
}

// ── 5. Publish (interactive OTP) ───────────────────────────────────────
if (!noPublish) {
  step(`npm publish ${PKG_NAME}@${newV} (OTP/web-auth may prompt)`);
  if (!dryRun) {
    const { spawnSync } = require("node:child_process");
    const r = spawnSync("npm", ["publish"], { stdio: "inherit", cwd: CLI_DIR });
    if (r.status !== 0) die(`npm publish exited ${r.status}`);
  }
  ok("published");
} else {
  say("publish skipped (--no-publish)");
}

// ── 6. Commit, tag, push, verify ───────────────────────────────────────
step("Commit cli package.json + changelog, tag & push");
if (!dryRun) {
  sh(`git add cli/package.json package-lock.json cli/CHANGELOG.md cli/app 2>/dev/null || git add cli/package.json cli/CHANGELOG.md cli/app`, { cwd: ROOT_DIR, quiet: true });
  sh(`git commit -m "chore(cli): release ${newV}" || true`, { cwd: ROOT_DIR, quiet: true });
  sh(`git tag "cli-v${newV}"`, { cwd: ROOT_DIR });
  sh("git push origin master --follow-tags", { cwd: ROOT_DIR });
}
ok("pushed with tag");

if (!noPublish && !dryRun) {
  step("Verify registry serves the new version");
  let tries = 0;
  const max = 10;
  while (tries++ < max) {
    try {
      const v = execSync(`npm view ${PKG_NAME} version`, { encoding: "utf8", cwd: CLI_DIR }).trim();
      if (v === newV) { ok(`registry serves ${v}`); break; }
    } catch {}
    say(`  waiting for registry propagation (${tries}/${max})…`);
    execSync("sleep 15");
  }
}

console.log(`\n\x1b[32m✅ ${PKG_NAME}@${newV} released.\x1b[0m Users: \x1b[1mnpm i -g @synthever/jrouter@latest\x1b[0m\n`);
