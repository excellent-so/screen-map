// Screen Map — headless-browser helpers (shell out to Chrome, zero deps).
//
// Two hard-won details from bring-up:
//  1. Use `--headless=new` with an ISOLATED `--user-data-dir`; the old `--headless`
//     on the default profile collides with the user's running Chrome and hangs.
//  2. Turbopack/webpack dev compiles each route on first request, so a cold
//     screenshot fires before the page paints. We warm-fetch the URL (triggering
//     the compile) and wait for it before driving Chrome.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env, paths } from "./env.mjs";

const chromePath = () => env().chrome?.path || null;
export const hasChrome = () => Boolean(env().chrome?.has);

function run(args, { timeout = 45000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    // SIGKILL (not the default SIGTERM): headless Chrome ignores SIGTERM and hangs
    // the worker past the timeout, stalling the whole build. Force-kill it.
    const child = execFile(chromePath(), args, { timeout, maxBuffer, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || "", stderr: stderr || "" });
    });
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } resolve({ err: new Error("hard-timeout"), stdout: "", stderr: "" }); }, timeout + 8000);
    child.on("exit", () => clearTimeout(t));
  });
}

/** The flags every Chrome run gets. The keychain and password-store flags keep Chrome from
 *  asking the OS for stored secrets: with a fresh or unusual HOME (CI, a sandbox, a new user)
 *  macOS would otherwise prompt for a keychain and the headless run hangs until it times out.
 *  The color scheme is fixed (config.colorScheme, light by default): headless Chrome otherwise
 *  follows the OS theme, and a machine that turns dark at sunset would show every screen as changed. */
export function baseArgs(profile) {
  const scheme = env().config?.colorScheme === "dark" ? 0 : 1; // Blink: 0 is dark, 1 is light
  return [
    "--headless=new",
    `--user-data-dir=${path.join(paths().OUT_DIR, ".chrome", profile)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    "--disable-background-networking",
    "--use-mock-keychain",
    "--password-store=basic",
    `--blink-settings=preferredColorScheme=${scheme}`,
  ];
}

/** True when `url` gives any HTTP answer (a 404 or a redirect counts) within `timeoutMs`. */
export async function answers(url, timeoutMs = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: "manual", signal: ctl.signal });
    await r.body?.cancel().catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Hit the URL once so the dev server compiles the route before we render it. */
export async function warmFetch(url, timeoutMs = 35000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctl.signal });
    await r.text().catch(() => {});
    return { ok: true, status: r.status, finalUrl: r.url, contentType: r.headers.get("content-type") || "" };
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}

/** Screenshot a URL to `outFile`. Returns { ok, bytes }. */
export async function screenshot(url, outFile, opts = {}) {
  if (!chromePath()) return { ok: false, error: "no-chrome" };
  const { width = 1440, height = 1400, virtualTime = 9000, profile = "cap0", warm = true, timeout = 60000, harvest = false } = opts;
  let finalUrl = url;
  if (warm) {
    // If the dev server is unreachable, DON'T screenshot — Chrome would capture a
    // "This site can't be reached" page and (being >2KB) cache it as a real shot.
    const w = await warmFetch(url);
    if (!w.ok) return { ok: false, error: "unreachable:" + (w.status || w.error || "?") };
    finalUrl = w.finalUrl || url;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }
  const args = [
    ...baseArgs(profile),
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${virtualTime}`,
    `--screenshot=${outFile}`,
  ];
  if (harvest) args.push("--dump-dom"); // one pass: screenshot + rendered DOM (real nav links)
  args.push(url);
  const { stdout } = await run(args, { timeout, maxBuffer: 96 * 1024 * 1024 });
  const dom = harvest ? stdout : "";
  try {
    const st = fs.statSync(outFile);
    if (st.size > 2048) return { ok: true, bytes: st.size, dom, finalUrl };
    // A near-empty PNG means the render failed. DELETE it — otherwise the tiny file
    // satisfies the mtime idempotency check next run and is reported as valid forever.
    try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }
    return { ok: false, error: "empty", bytes: st.size, dom, finalUrl };
  } catch {
    return { ok: false, error: "no-file", dom, finalUrl };
  }
}

/** Render a URL and return its post-hydration DOM as a string. */
export async function dumpDom(url, opts = {}) {
  if (!chromePath()) return "";
  const { virtualTime = 8000, profile = "dom0", warm = true, timeout = 55000 } = opts;
  if (warm) await warmFetch(url);
  const args = [...baseArgs(profile), `--virtual-time-budget=${virtualTime}`, "--dump-dom", url];
  const { stdout } = await run(args, { timeout });
  return stdout;
}
