// Screen Map — config: discover, load, and normalize `screen-map.config.*`.
//
// A stock Next.js App Router app needs no config at all. Everything that differs
// between apps (app dir, group taxonomy, nav backbone, cold-start pattern, flows) is
// an optional key whose default works when it is left out.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserError } from "./errors.mjs";

const CONFIG_NAMES = [
  "screen-map.config.mjs",
  "screen-map.config.js",
  "screen-map.config.cjs",
  "screen-map.config.json",
];

/** The zero-config defaults for a standard Next.js App Router app. */
export function defaults() {
  return {
    appDir: null, // auto-detected: "app" or "src/app"
    devBaseUrl: "http://localhost:3000",
    framework: "next-app-router",
    discovery: ["router-walk", "crawl"], // the walk ∪ the crawl; both by default
    // At most this many pages that only the crawl found get screenshots (nearest `/`
    // first), so a big site can't run on and on. 0 takes none.
    crawlCaptureMax: 100,
    // Section taxonomy. A function (route → group) or a { root: group } map. Default:
    // the first path segment, which is a sensible generic grouping for any app.
    groups: null,
    navBackbone: [], // optional global-nav targets (list of { to, label } or "/path")
    noChromeRoots: [], // route roots where global chrome is absent (auth/takeover)
    coldStartPattern: null, // optional regex (string or RegExp) for empty-state hints
    flows: [], // optional declared state-machine flows (see flows.mjs)
    // Auto-discover state-machine screens (query-param / dynamic-[param] axes) from
    // route source — the general replacement for hand-authored `flows`. ON by default
    // (a stock app benefits with zero config); bool or { enabled, maxPerRoute, maxTotal }.
    stateSweep: true,
    // The one generic escape hatch a redirect/auth-gated route needs so a forced state
    // renders: append ?<param>=<value> to swept states of gated routes. null | string |
    // { param, value }. Query-param routes that honor their own params need nothing.
    statePreview: null,
    sampleParams: {}, // seed values for dynamic-route resolution ({ param: [values] })
    // Route-URL PINS: map a route PATTERN → a concrete URL, resolved before seeds +
    // DOM harvest. The escape hatch for dynamic routes the harvest can't reach — an
    // overloaded `[id]` param, a detail route with no scrapeable index, or a section-
    // scoped route whose real index lives elsewhere. A local .screenmap/route-urls.json
    // merges on top ({ "/x/[id]": "/x/42" }).
    routeUrls: {},
    chrome: null, // optional explicit Chrome/Chromium path
    colorScheme: "light", // the color scheme pages are captured in: "light" or "dark"
    output: { adapter: "markdown" }, // "markdown" | "github"
    exclude: [], // route(s) to drop from the map — exact ("/login") drops it + its descendants
    // Optional MANAGED dev server: when set (or `--managed-server`), Screen Map spins
    // up its OWN disposable dev server on an ephemeral port, captures against it, then
    // tears it down fully — no dependency on a server you keep running (immune to the
    // mid-run wedge that fails long captures). See server.mjs for the shape; `autostart:
    // true` uses it every run without the flag. null → capture against `devBaseUrl`.
    server: null,
  };
}

/** The address the last build in `root` was given with --base or SCREENMAP_BASE, or null. */
function lastBuildBase(root) {
  try {
    const map = JSON.parse(fs.readFileSync(path.join(root, ".screenmap", "screenmap.json"), "utf8"));
    return map?.build?.baseGiven && typeof map.build.devBaseUrl === "string" ? map.build.devBaseUrl : null;
  } catch { return null; }
}

/** Find the nearest config file walking up from `startDir`. Returns { file, dir } | null. */
export function findConfig(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return { file, dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/** Auto-detect the App Router directory under `root`: `app/` then `src/app/`. */
export function detectAppDir(root) {
  for (const candidate of ["app", "src/app"]) {
    const abs = path.join(root, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return candidate;
  }
  return "app"; // last-resort default; a build will report zero screens if wrong
}

async function loadRaw(file) {
  try {
    if (file.endsWith(".json")) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    // ESM/CJS config: import as a module and take the default export (or the module).
    const mod = await import(pathToFileURL(file).href);
    return mod.default ?? mod;
  } catch (e) {
    const where = path.relative(process.cwd(), file) || file;
    throw new UserError(`Couldn't load ${where}: ${String((e && e.message) || e).split("\n")[0]}. Fix it, or delete it to use the defaults.`);
  }
}

/**
 * The dev server's address in the form the engine joins paths onto: "localhost:3000" gets
 * http://, and a trailing slash, query or hash goes. Anything it can't read comes back as given,
 * for baseUrlProblem() to explain.
 */
export function normalizeBaseUrl(raw) {
  let s = String(raw ?? "").trim();
  if (s && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return String(raw ?? "");
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch { return String(raw ?? ""); }
}

/** Why `base` can't be loaded, as one sentence, or null when it is an http(s) URL. */
export function baseUrlProblem(base) {
  try {
    const u = new URL(base);
    if (/^https?:$/.test(u.protocol) && u.hostname) return null;
  } catch { /* not a URL */ }
  return `"${base}" isn't a web address. Pass your dev server's address, like --base=http://localhost:3000.`;
}

/** Coerce `config.groups` into a `(route) => group` function. */
function normalizeGroups(groups) {
  if (typeof groups === "function") return groups;
  if (groups && typeof groups === "object") {
    // { root-segment: group } map, else the root segment itself.
    return (route) => {
      const root = route.split("/").filter(Boolean)[0] || "root";
      return groups[root] || root;
    };
  }
  // Default: the first path segment is the group.
  return (route) => route.split("/").filter(Boolean)[0] || "root";
}

/** Coerce a nav-backbone entry ("/path" or { to, label }) into { to, label }. */
function normalizeBackbone(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => (typeof t === "string" ? { to: t, label: t } : t))
    .filter((t) => t && typeof t.to === "string");
}

/** A count ≥ 0 (Infinity allowed) from a number or numeric string; false is 0; else `dflt`. */
function normalizeCount(v, dflt) {
  if (v === false) return 0;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return n >= 0 ? Math.floor(n) : dflt;
}

function normalizeColdPattern(p) {
  if (!p) return null;
  if (p instanceof RegExp) return p;
  try { return new RegExp(String(p)); } catch { return null; }
}

/**
 * Resolve the effective config. Merges (defaults ← file ← env ← overrides), detects
 * the app dir, and normalizes shapes. Returns { config, root, file }.
 *
 * @param {object} [o]
 * @param {string} [o.cwd]        where to start looking (default process.cwd())
 * @param {object} [o.overrides]  CLI-supplied overrides (highest precedence)
 */
export async function loadConfig({ cwd = process.cwd(), overrides = {} } = {}) {
  const found = findConfig(cwd);
  const root = found ? found.dir : path.resolve(cwd);
  const base = defaults();
  const fromFile = found ? await loadRaw(found.file) : {};

  const merged = { ...base, ...fromFile, ...overrides };
  // Env escape hatches (overrides win over env).
  if (!overrides.devBaseUrl && process.env.SCREENMAP_BASE) merged.devBaseUrl = process.env.SCREENMAP_BASE;
  // Where the dev server's address came from. With none given, the address the last build was
  // given (--base or SCREENMAP_BASE) carries over, so `open`'s refresh, `recapture` and the next
  // build load the same app without being told again.
  merged.devBaseUrlFrom = overrides.devBaseUrl ? "flag" : process.env.SCREENMAP_BASE ? "env" : fromFile.devBaseUrl ? "config" : "default";
  if (merged.devBaseUrlFrom === "default") {
    const last = lastBuildBase(root);
    if (last) { merged.devBaseUrl = last; merged.devBaseUrlFrom = "last build"; }
  }
  if (!overrides.chrome && (process.env.SCREENMAP_CHROME || process.env.CHROME || process.env.CHROME_PATH)) {
    merged.chrome = process.env.SCREENMAP_CHROME || process.env.CHROME || process.env.CHROME_PATH;
  }

  merged.devBaseUrl = normalizeBaseUrl(merged.devBaseUrl);

  // Auto-detect the app dir when not given.
  if (!merged.appDir) merged.appDir = detectAppDir(root);

  // Normalize shapes so the engine never has to branch on config form.
  merged.groupsFn = normalizeGroups(merged.groups);
  merged.navBackbone = normalizeBackbone(merged.navBackbone);
  merged.noChromeRoots = new Set(Array.isArray(merged.noChromeRoots) ? merged.noChromeRoots : []);
  merged.coldStartPattern = normalizeColdPattern(merged.coldStartPattern);
  merged.flows = Array.isArray(merged.flows) ? merged.flows : [];
  merged.discovery = Array.isArray(merged.discovery) ? merged.discovery : [merged.discovery].filter(Boolean);
  merged.output = merged.output && typeof merged.output === "object" ? merged.output : { adapter: "markdown" };
  merged.exclude = (Array.isArray(merged.exclude) ? merged.exclude : [merged.exclude]).filter((p) => typeof p === "string" && p);
  merged.crawlCaptureMax = normalizeCount(merged.crawlCaptureMax, base.crawlCaptureMax);
  merged.colorScheme = merged.colorScheme === "dark" ? "dark" : "light";

  return { config: merged, root, file: found ? found.file : null };
}
