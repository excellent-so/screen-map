// Screen Map — managed dev server tests. Hermetic: a tiny Node HTTP server stands
// in for the user's `next dev`, so this exercises the real boot → ready → teardown
// lifecycle with no framework or network dependency.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { ok, eq } from "./helpers.mjs";
import { normalizeServer, startManagedServer } from "../src/server.mjs";

// A minimal dev server: listens on $PORT and 200s everything. Written to a temp
// file and driven exactly as a real `command` would be.
const STUB = `
import http from "node:http";
const port = Number(process.env.PORT);
http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); }).listen(port, "127.0.0.1");
`;

async function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(p, "127.0.0.1");
  });
}

export async function run() {
  // ── normalizeServer ──────────────────────────────────────────────────────
  eq(normalizeServer(null), null, "normalizeServer(null) → null");
  eq(normalizeServer(""), null, "normalizeServer('') → null");
  {
    const s = normalizeServer("next dev");
    ok(Array.isArray(s.command) && s.command[0] === "next" && s.command[1] === "dev", "string command → argv array");
    eq(s.portFlag, "-p", "default portFlag is -p");
    eq(s.readyPath, "/", "default readyPath is /");
    ok(s.watchdog === true, "watchdog defaults on");
  }
  {
    const s = normalizeServer({ command: ["pnpm", "dev"], portFlag: null, watchdog: false, port: 4321 });
    eq(s.command, ["pnpm", "dev"], "array command passes through");
    eq(s.portFlag, null, "portFlag:null preserved (PORT env only)");
    ok(s.watchdog === false, "watchdog:false preserved");
    eq(s.port, 4321, "explicit port preserved");
  }

  // ── boot → ready → full teardown ─────────────────────────────────────────
  const dir = mkdtempSync(path.join(tmpdir(), "screen-map-srvtest-"));
  const stub = path.join(dir, "stub-server.mjs");
  writeFileSync(stub, STUB);
  const logs = [];
  let managed = null;
  try {
    managed = await startManagedServer({
      root: dir,
      log: (m) => logs.push(m),
      // portFlag:null → the stub reads PORT from env (it takes no CLI port arg).
      server: { command: ["node", stub], portFlag: null, portBase: 4930, readyPath: "/", readyTimeoutMs: 15000, watchdog: false },
    });
    ok(/^http:\/\/localhost:\d+$/.test(managed.base), `managed.base looks like a URL (${managed.base})`);

    const r = await fetch(managed.base + "/");
    ok(r.status === 200, "managed server answers 200 while up");
    eq(await r.text(), "ok", "managed server returns the stub body");
    eq(managed.restarts(), 0, "no restarts on a healthy run");
  } finally {
    if (managed) await managed.stop();
  }

  // After stop(), the port must be free again (process-group killed).
  const port = Number(new URL(managed.base).port);
  let freed = false;
  for (let i = 0; i < 20; i++) {
    if (await portFree(port)) { freed = true; break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  ok(freed, `port ${port} freed after stop() — server torn down`);

  // The project's own binaries are found, as under `npm run`: a command that lives only in
  // node_modules/.bin starts with Screen Map run from anywhere.
  const binDir = path.join(dir, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const localBin = path.join(binDir, "my-dev-server");
  writeFileSync(localBin, `#!${process.execPath}\n` + STUB, { mode: 0o755 });
  let local = null;
  try {
    local = await startManagedServer({ root: dir, server: { command: "my-dev-server", portFlag: null, portBase: 4960, readyTimeoutMs: 15000, watchdog: false } });
    eq(await (await fetch(local.base + "/")).text(), "ok", "a command in the project's node_modules/.bin starts");
  } catch (e) {
    ok(false, `a command in the project's node_modules/.bin starts (${e.message})`);
  } finally {
    if (local) await local.stop();
  }

  // A command that isn't installed fails fast, in one sentence.
  const t0 = Date.now();
  let err = null;
  try { await startManagedServer({ root: dir, server: { command: "no-such-dev-server dev", portBase: 4990, readyTimeoutMs: 60000, watchdog: false } }); }
  catch (e) { err = e; }
  ok(err && err.name === "UserError" && err.message.includes("`no-such-dev-server` isn't installed in this project"), `a missing server command says so (${err && err.message})`);
  ok(Date.now() - t0 < 15000, "…without waiting out the ready timeout");

  // A command that exits before it answers says so.
  let exitErr = null;
  try { await startManagedServer({ root: dir, server: { command: ["node", "-e", "process.exit(3)"], portFlag: null, portBase: 4995, readyTimeoutMs: 60000, watchdog: false } }); }
  catch (e) { exitErr = e; }
  ok(exitErr && /stopped \(exit 3\) before it answered/.test(exitErr.message), `a server that exits early says so (${exitErr && exitErr.message})`);

  try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}
