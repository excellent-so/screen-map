// Screen Map — test helpers: a tiny assert harness, fixture setup, and what the end-to-end
// tests share: a stand-in browser, a way to run the CLI, and small local sites.

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { initEnv } from "../src/env.mjs";

export const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixture");
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "screen-map.mjs");

let passed = 0, failed = 0;
const failures = [];

export function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}

export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(a === e, `${msg} — expected ${e}, got ${a}`);
}

export function includes(arr, val, msg) {
  ok(Array.isArray(arr) && arr.includes(val), `${msg} — ${JSON.stringify(arr)} should include ${JSON.stringify(val)}`);
}

export function excludes(arr, val, msg) {
  ok(Array.isArray(arr) && !arr.includes(val), `${msg} — ${JSON.stringify(arr)} should NOT include ${JSON.stringify(val)}`);
}

export function report(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  return { passed, failed, failures };
}

/** Load the fixture config and install the runtime env (no Chrome). */
export async function setupFixture(overrides = {}) {
  const { config, root } = await loadConfig({ cwd: FIXTURE_DIR, overrides });
  return initEnv({ root, config, chrome: { path: null, has: false, source: null } });
}

/** Install the env from an explicit config object (for degradation tests). */
export async function setupWith(configOverrides = {}) {
  const { config, root } = await loadConfig({ cwd: FIXTURE_DIR, overrides: configOverrides });
  return initEnv({ root, config, chrome: { path: null, has: false, source: null } });
}

// ---- End to end ---------------------------------------------------------------

export const PNG = "89504e470d0a1a0a";

// A stand-in for headless Chrome: a small Node script that takes the flags Screen Map passes (the URL
// last) and does what they ask over plain HTTP. --screenshot writes a PNG signature, then
// "screenshot of <url>", padded past the 2 KB a real shot must reach; --dump-dom prints the page.
const FAKE_CHROME = `
import fs from "node:fs";
const args = process.argv.slice(2);
const url = args[args.length - 1];
const shot = (args.find((a) => a.startsWith("--screenshot=")) || "").slice("--screenshot=".length);
let html;
try { html = await (await fetch(url)).text(); } catch { process.exit(1); }
if (shot) fs.writeFileSync(shot, Buffer.concat([Buffer.from("${PNG}", "hex"), Buffer.from("screenshot of " + url + "\\n"), Buffer.alloc(4096, 32)]));
if (args.includes("--dump-dom")) process.stdout.write(html);
`;

/** Write the stand-in browser into `dir`; returns its path (pass it as --chrome). Not for Windows. */
export function writeFakeChrome(dir) {
  const file = path.join(dir, "fake-chrome.mjs");
  fs.writeFileSync(file, `#!${process.execPath}\n${FAKE_CHROME}`, { mode: 0o755 });
  return file;
}

/** Run `screen-map <args>` in `cwd` (with `env`, and `input` on stdin); resolves to { code, log, map }
 *  (map: .screenmap/screenmap.json). */
export function runCli(cwd, args, { env = process.env, input = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
    if (input != null) child.stdin.end(input);
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    const timer = setTimeout(() => { log += "\n(timed out)\n"; child.kill("SIGKILL"); }, 90000);
    child.on("close", (code) => {
      clearTimeout(timer);
      let map = null;
      try { map = JSON.parse(fs.readFileSync(path.join(cwd, ".screenmap", "screenmap.json"), "utf8")); } catch { /* no map */ }
      resolve({ code, log, map });
    });
  });
}

/** Serve `routes` ({ "/path": (req, res) => void }) on a free 127.0.0.1 port; anything else is an HTML 404. */
export function serveRoutes(routes) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    const handler = routes[pathname];
    if (handler) handler(req, res);
    else { res.writeHead(404, { "content-type": "text/html" }); res.end("<h1>Not found</h1>"); }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
  })));
}

/** A route handler that answers 200 with an HTML page around `body` (a string, or a function returning one). */
export const htmlPage = (body) => (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><body>${typeof body === "function" ? body() : body}</body></html>`);
};

/** A screen's default-state capture, when it has one. */
export const shotOf = (s) => (s?.states || []).find((x) => x.state === "default" && x.ok && x.shot) || null;
