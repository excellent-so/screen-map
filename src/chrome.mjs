// Screen Map — chrome: tiered, find-first, never-bundle browser strategy.
//
//  1. Fast path — find a system Chrome/Chromium/Edge/Brave (env → known install
//     locations per-OS → `which`). Zero-dep, raw filesystem probing.
//  2. Miss → print the exact missing thing + fix, then OPTIONALLY download-on-demand
//     via @puppeteer/browsers into ~/.cache/screen-map/, on first run, with a
//     visible progress bar — NEVER a hidden postinstall.
//  3. Never bundle Chromium — version drift is irrelevant for screenshots, and a
//     bundle blows the Open VSX 256 MB cap.
//
// The @puppeteer/browsers dependency is OPTIONAL and lazy-imported only for the
// download fallback, so the common (system-Chrome) case stays truly zero-dep.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const CACHE_DIR = path.join(os.homedir(), ".cache", "screen-map");

/** Known Chrome-family install locations by platform. */
function knownPaths() {
  const plt = process.platform;
  if (plt === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Arc.app/Contents/MacOS/Arc",
    ];
  }
  if (plt === "win32") {
    const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local");
    return [
      path.join(pf, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(pf, "Chromium\\Application\\chrome.exe"),
      path.join(local, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
    ];
  }
  // linux + others
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
    "/opt/google/chrome/chrome",
  ];
}

/** Resolve a binary name on PATH (Chrome family) via `which`/`where`. */
function fromPath() {
  const names = process.platform === "win32"
    ? ["chrome", "msedge", "chromium"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];
  const finder = process.platform === "win32" ? "where" : "which";
  for (const name of names) {
    try {
      const out = execFileSync(finder, [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      const first = out.split(/\r?\n/)[0];
      if (first && fs.existsSync(first)) return first;
    } catch { /* not on PATH */ }
  }
  return null;
}

/** A previously downloaded Chrome from the on-demand cache, if present. */
function fromCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return null;
    // @puppeteer/browsers lays out chrome/<platform>-<build>/chrome-*/<exe>.
    const chromeRoot = path.join(CACHE_DIR, "chrome");
    if (!fs.existsSync(chromeRoot)) return null;
    for (const build of fs.readdirSync(chromeRoot)) {
      const dir = path.join(chromeRoot, build);
      const exe = locateExe(dir);
      if (exe) return exe;
    }
  } catch { /* ignore */ }
  return null;
}

/** Best-effort recursive search for a chrome executable under a directory. */
function locateExe(dir, depth = 0) {
  if (depth > 4) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const exeNames = new Set(
    process.platform === "win32" ? ["chrome.exe"]
      : process.platform === "darwin" ? ["Google Chrome for Testing", "Chromium", "Google Chrome"]
        : ["chrome", "chrome-headless-shell"],
  );
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && exeNames.has(ent.name)) return full;
    if (ent.isDirectory()) {
      const found = locateExe(full, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find a usable Chrome. Order: explicit path (config/env) → known install locations
 * → PATH → previously downloaded cache. Returns an absolute path or null.
 */
export function findChrome(explicit) {
  const candidates = [explicit, ...knownPaths()].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return fromPath() || fromCache();
}

/** The exact, actionable message when no browser is found. */
export function missingBrowserMessage() {
  return [
    "No Chrome/Chromium found to take screenshots.",
    "",
    "Fix it one of these ways:",
    "  • Install Google Chrome:      https://www.google.com/chrome/",
    "  • Point Screen Map at yours:  SCREENMAP_CHROME=/path/to/chrome screen-map build",
    "    (or set `chrome` in screen-map.config.*)",
    "  • Let Screen Map fetch one:   screen-map build --download-chrome",
    "",
    "Screen Map never bundles a browser and never runs a hidden postinstall.",
  ].join("\n");
}

/**
 * Download Chrome-for-Testing on demand into ~/.cache/screen-map/ with a progress
 * bar. Lazy-imports the OPTIONAL @puppeteer/browsers dependency; returns the exe
 * path, or throws a clear error if the optional dep isn't installed.
 */
export async function downloadChrome({ log = console.error } = {}) {
  let browsers;
  try {
    browsers = await import("@puppeteer/browsers");
  } catch {
    throw new Error(
      "On-demand Chrome download needs the optional `@puppeteer/browsers` package.\n" +
      "Install it once:  npm i -D @puppeteer/browsers\n" +
      "…or install system Chrome and re-run (recommended).",
    );
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const { install, resolveBuildId, Browser, detectBrowserPlatform } = browsers;
  const platform = detectBrowserPlatform();
  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  let lastPct = -1;
  log(`↓ downloading Chrome ${buildId} into ${CACHE_DIR} …`);
  const installed = await install({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CACHE_DIR,
    downloadProgressCallback: (downloaded, total) => {
      if (!total) return;
      const pct = Math.floor((downloaded / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; log(`  ${pct}%`); }
    },
  });
  log(`✓ Chrome ready: ${installed.executablePath}`);
  return installed.executablePath;
}

/**
 * Resolve the browser for a run. Returns { path, has, source }.
 *  - source: "explicit" | "system" | "cache" | "download" | null
 */
export async function resolveChrome({ explicit, allowDownload = false, log = console.error } = {}) {
  const found = findChrome(explicit);
  if (found) {
    const source = explicit && found === explicit ? "explicit" : found.startsWith(CACHE_DIR) ? "cache" : "system";
    return { path: found, has: true, source };
  }
  if (allowDownload) {
    const dl = await downloadChrome({ log });
    return { path: dl, has: true, source: "download" };
  }
  return { path: null, has: false, source: null };
}
