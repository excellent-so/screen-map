// Screen Map — managed dev server (the "own server" capability).
//
// By default Screen Map captures against a dev server you already have running
// (`devBaseUrl`). That coupling is fragile for long/unattended runs: if the shared
// server wedges mid-capture, every remaining screenshot fails. With a `server`
// block in the config (or `--managed-server`), Screen Map instead spins up its OWN
// dev server, captures against it, and tears it down FULLY afterward:
//
//   • Ephemeral port      — never collides with your own :3000 (auto-picked).
//   • Isolated build dir   — optional `distDirEnv` so a second Next dev server
//                            doesn't share (and corrupt) your `.next` cache.
//   • Health watchdog      — a wedged server is killed and respawned on the SAME
//                            port, so the capture base URL never changes.
//   • Full teardown        — process-GROUP kill (SIGTERM→SIGKILL) wired to stop()
//                            and to SIGINT/SIGTERM/exit, so nothing leaks.
//
// Config (`server` key):
//   {
//     command: "next dev",        // dev command (string → whitespace-split, or argv array)
//     cwd: ".",                   // relative to the config root
//     port: 0,                    // 0 → auto-pick from portBase; else pin this port
//     portBase: 3300,             // first port to probe when auto-picking
//     portFlag: "-p",             // how the port is passed as an arg (null → PORT env only)
//     readyPath: "/",             // health path polled until the server answers
//     readyTimeoutMs: 240000,
//     env: {},                    // extra env (e.g. point the app at a throwaway data dir)
//     distDirEnv: null,           // env var your app reads to relocate its build dir
//     distDir: ".screen-map-dev", // value for distDirEnv (isolated build cache)
//     prepare: null,              // optional command run once before boot (seed/copy a disposable DB)
//     watchdog: true,
//   }
//
// Zero-dep, Node built-ins only.

import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

const HEALTH_INTERVAL_MS = 20_000;
const HEALTH_TIMEOUT_MS = 10_000;
const HEALTH_FAILS_TO_RESTART = 3;

/** Coerce config.server (string | array | object | null) into a normalized object, or null. */
export function normalizeServer(server) {
  if (!server) return null;
  const s = typeof server === "string" || Array.isArray(server) ? { command: server } : { ...server };
  if (!s.command) return null;
  s.command = Array.isArray(s.command) ? s.command.slice() : String(s.command).trim().split(/\s+/);
  s.cwd = s.cwd || ".";
  s.port = Number.isFinite(Number(s.port)) ? Number(s.port) : 0;
  s.portBase = Number.isFinite(Number(s.portBase)) ? Number(s.portBase) : 3300;
  s.portFlag = s.portFlag === null ? null : (s.portFlag || "-p");
  s.readyPath = s.readyPath || "/";
  s.readyTimeoutMs = Number.isFinite(Number(s.readyTimeoutMs)) ? Number(s.readyTimeoutMs) : 240_000;
  s.env = s.env && typeof s.env === "object" ? s.env : {};
  s.distDirEnv = s.distDirEnv || null;
  s.distDir = s.distDir || ".screen-map-dev";
  s.prepare = s.prepare || null;
  s.watchdog = s.watchdog !== false;
  return s;
}

function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(p, "127.0.0.1");
  });
}

async function pickPort(start) {
  for (let p = start; p < start + 40; p++) if (await portFree(p)) return p;
  return start;
}

async function reachable(base, readyPath, timeoutMs = HEALTH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(base + readyPath, { method: "GET", signal: ctrl.signal });
    return r.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function waitForReady(base, readyPath, timeoutMs, isAlive) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isAlive && !isAlive()) return false;
    if (await reachable(base, readyPath)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Start a managed dev server from a normalized `server` config. Returns
 * { base, port, stop(), restarts() }.
 *
 * @param {object} o
 * @param {object} o.server  normalized server config (see normalizeServer)
 * @param {string} o.root    config root (cwd is resolved relative to it)
 * @param {(m:string)=>void} [o.log]
 */
export async function startManagedServer({ server, root, log = () => {} }) {
  const cfg = normalizeServer(server);
  if (!cfg) throw new Error("managed server: no `server.command` configured");
  const cwd = path.resolve(root, cfg.cwd);
  const port = cfg.port > 0 ? cfg.port : await pickPort(cfg.portBase);
  const base = `http://localhost:${port}`;

  const childEnv = {
    ...process.env,
    ...cfg.env,
    PORT: String(port),
    SCREENMAP_BASE: "", // never let an inherited override redirect the child
  };
  if (cfg.distDirEnv) childEnv[cfg.distDirEnv] = cfg.distDir;

  if (cfg.prepare) {
    log(`● managed server: prepare — ${Array.isArray(cfg.prepare) ? cfg.prepare.join(" ") : cfg.prepare}`);
    const pre = Array.isArray(cfg.prepare) ? cfg.prepare : String(cfg.prepare).trim().split(/\s+/);
    const r = spawnSync(pre[0], pre.slice(1), { cwd, env: childEnv, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`managed server: prepare step failed (exit ${r.status})`);
  }

  const argv = cfg.portFlag ? [...cfg.command.slice(1), cfg.portFlag, String(port)] : cfg.command.slice(1);
  log(`● managed dev server`);
  log(`  command:  ${cfg.command[0]} ${argv.join(" ")}  (cwd ${path.relative(root, cwd) || "."})`);
  log(`  port:     ${port}${cfg.distDirEnv ? `  ·  ${cfg.distDirEnv}=${cfg.distDir}` : ""}`);
  log(`  first boot compiles on demand — this can take a while…`);

  let server_ = null;
  let stopped = false;
  let restarts = 0;
  let watchTimer = null;

  const spawnServer = () =>
    spawn(cfg.command[0], argv, { cwd, detached: true, stdio: ["ignore", "inherit", "inherit"], env: childEnv });
  const killGroup = (sig) => { try { if (server_?.pid) process.kill(-server_.pid, sig); } catch { /* gone */ } };
  const alive = () => Boolean(server_) && server_.exitCode === null && !server_.killed;

  server_ = spawnServer();

  if (!(await waitForReady(base, cfg.readyPath, cfg.readyTimeoutMs, alive))) {
    await hardStop();
    throw new Error(`managed server did not become ready on :${port} within ${cfg.readyTimeoutMs / 1000}s`);
  }
  log(`  ✓ ready at ${base}`);

  async function hardStop() {
    if (stopped) return;
    stopped = true;
    if (watchTimer) clearInterval(watchTimer);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("exit", onExit);
    killGroup("SIGTERM");
    await new Promise((r) => setTimeout(r, 1500));
    killGroup("SIGKILL");
    log(`  ✓ torn down managed server`);
  }

  const onExit = () => { if (!stopped) { stopped = true; if (watchTimer) clearInterval(watchTimer); killGroup("SIGKILL"); } };
  const onSignal = () => { hardStop().finally(() => process.exit(130)); };
  process.on("exit", onExit);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  if (cfg.watchdog) {
    let consecutive = 0;
    let restarting = false;
    watchTimer = setInterval(async () => {
      if (stopped || restarting) return;
      const ok = alive() && (await reachable(base, cfg.readyPath));
      if (ok) { consecutive = 0; return; }
      if (++consecutive < HEALTH_FAILS_TO_RESTART) return;
      restarting = true;
      consecutive = 0;
      restarts++;
      log(`  ⟳ server unhealthy — restart #${restarts} (reusing :${port})…`);
      killGroup("SIGKILL");
      await new Promise((r) => setTimeout(r, 2000));
      if (stopped) { restarting = false; return; }
      server_ = spawnServer();
      const back = await waitForReady(base, cfg.readyPath, cfg.readyTimeoutMs, alive);
      log(back ? `  ✓ server back at ${base}` : `  ✖ server did not recover after restart #${restarts}`);
      restarting = false;
    }, HEALTH_INTERVAL_MS);
    watchTimer.unref();
  }

  return { base, port, restarts: () => restarts, stop: hardStop };
}
