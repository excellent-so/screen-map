// Screen Map — config: discover, load, and normalize `screen-map.config.*`.
//
// A stock Next.js App Router app needs no config at all. Everything that differs
// between apps (app dir, group taxonomy, nav backbone, cold-start pattern, flows) is
// an optional key whose default works when it is left out.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  if (file.endsWith(".json")) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  // ESM/CJS config: import as a module and take the default export (or the module).
  const mod = await import(pathToFileURL(file).href);
  return mod.default ?? mod;
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
  if (!overrides.chrome && (process.env.SCREENMAP_CHROME || process.env.CHROME || process.env.CHROME_PATH)) {
    merged.chrome = process.env.SCREENMAP_CHROME || process.env.CHROME || process.env.CHROME_PATH;
  }

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

  return { config: merged, root, file: found ? found.file : null };
}
