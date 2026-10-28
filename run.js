"use strict";

/**
 * JRouter entrypoint for PM2 (also runs under plain `node run.js`).
 *
 *   pm2 start run.js --name jrouter
 *   pm2 save
 *
 * It boots the same server the Docker image and `npm start` run, picking the
 * first production build that exists:
 *   1. `<NEXT_DIST_DIR>/standalone/custom-server.js` (standalone artifact)
 *   2. repo `custom-server.js`, which dispatches to `next start`
 *
 * pm2 starts this file with `node`, so the process that pm2 supervises is the
 * one that owns the listener: restart/reload/stop, `pm2 logs` and memory stats
 * behave like any other node app.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const ROOT = __dirname;

/**
 * Load `<root>/.env` without overriding values pm2/the shell already exported.
 * `process.loadEnvFile` (Node >= 20.12) has exactly that precedence.
 */
function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
    return;
  }

  // Fallback for older Node: minimal dotenv parser, same precedence.
  const content = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = value.length > 1 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0]);
    if (quoted) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

/** Resolve the production entrypoint, mirroring Dockerfile CMD / npm start. */
function resolveServer() {
  const distDir = path.join(ROOT, process.env.NEXT_DIST_DIR || ".next");

  const standaloneDir = path.join(distDir, "standalone");
  const standaloneEntry = path.join(standaloneDir, "custom-server.js");
  if (fs.existsSync(standaloneEntry) && fs.existsSync(path.join(standaloneDir, "server.js"))) {
    return { mode: "standalone", entry: standaloneEntry, distDir };
  }

  const repoEntry = path.join(ROOT, "custom-server.js");
  if (fs.existsSync(repoEntry) && fs.existsSync(path.join(distDir, "BUILD_ID"))) {
    return { mode: "next-start", entry: repoEntry, distDir };
  }

  return null;
}

/**
 * `next start` reads PORT from the environment but not HOSTNAME, so the repo
 * fallback would bind every interface no matter what HOSTNAME says. Pass both
 * explicitly to keep it identical to the standalone entry (which honours env).
 */
function startupArgs(server) {
  const args = process.argv.slice(2);
  if (server.mode !== "next-start") return args;

  const has = (short, long) =>
    args.some((a) => a === short || a === long || a.startsWith(`${long}=`));
  if (!has("-p", "--port")) args.push("--port", process.env.PORT);
  if (!has("-H", "--hostname")) args.push("--hostname", process.env.HOSTNAME);
  return args;
}

function boot() {
  loadDotEnv();

  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  process.env.PORT = process.env.PORT || "20128";
  if (process.env.NEXT_TELEMETRY_DISABLED === undefined) process.env.NEXT_TELEMETRY_DISABLED = "1";
  // An OS-exported HOSTNAME (docker, some shells) is not a bind address — Next
  // would try to listen on it and fail. Only an explicit value is honoured.
  if (!process.env.HOSTNAME || process.env.HOSTNAME === os.hostname()) {
    process.env.HOSTNAME = "0.0.0.0";
  }

  const server = resolveServer();
  if (!server) {
    console.error(`[JRouter] no production build found in ${path.join(ROOT, process.env.NEXT_DIST_DIR || ".next")}`);
    console.error("[JRouter] run `npm run build` first, then `pm2 start run.js --name jrouter`");
    process.exit(1);
  }

  process.chdir(ROOT);
  console.log(
    `[JRouter] mode=${server.mode} entry=${path.relative(ROOT, server.entry)} ` +
      `port=${process.env.PORT} host=${process.env.HOSTNAME}`
  );

  // Both entrypoints bootstrap only when `require.main === module`. Loading the
  // target as the main module makes it behave exactly like `node <entry>` while
  // keeping a single process, so pm2 signals and metrics stay attached to it.
  process.argv = [process.argv[0], server.entry, ...startupArgs(server)];
  Module._load(server.entry, null, true);
}

try {
  boot();
} catch (error) {
  console.error("[JRouter] failed to start:", (error && error.stack) || error);
  process.exit(1);
}
