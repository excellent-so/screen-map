// Screen Map — managed dev server tests. Hermetic: a tiny Node HTTP server stands
// in for the user's `next dev`, so this exercises the real boot → ready → teardown
// lifecycle with no framework or network dependency.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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

  try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}
