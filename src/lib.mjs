// Screen Map — shared helpers (zero-dep, plain Node ESM, Node built-ins only).
//
// Route derivation follows the Next.js App Router rules. The app dir and the group
// taxonomy come from the resolved config (env.mjs / config.mjs).

import fs from "node:fs";
import path from "node:path";
import { appDirAbs, cfg, paths } from "./env.mjs";

// ---- Route derivation (Next.js App Router rules) -------------------------

const PAGE_FILES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js", "page.mdx"]);

/** Walk the app dir for every page file, returning absolute file paths. */
export function findPageFiles(dir = appDirAbs(), acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (ent.name.startsWith("_")) continue; // private folders opt the subtree out of routing
      if (ent.name === "node_modules") continue;
      findPageFiles(path.join(dir, ent.name), acc);
    } else if (PAGE_FILES.has(ent.name)) {
      acc.push(path.join(dir, ent.name));
    }
  }
  return acc;
}

/**
 * Turn a page-file path into its URL route pattern, honoring App Router rules:
 * private `_folders` are dropped by the walk; `(groups)` and `@slots` are removed
 * from the URL; `[seg]` / `[...seg]` / `[[...seg]]` are kept as dynamic. Returns
 * null when the file lives under a segment that shouldn't route.
 */
export function routeForFile(file, appDir = appDirAbs()) {
  const rel = path.relative(appDir, path.dirname(file));
  if (rel === "") return "/";
  const parts = rel.split(path.sep).filter(Boolean);
  const kept = [];
  for (const seg of parts) {
    if (seg.startsWith("_")) return null; // private (defensive)
    if (seg.startsWith("(") && seg.endsWith(")")) continue; // route group
    if (seg.startsWith("@")) continue; // parallel slot
    kept.push(seg);
  }
  return "/" + kept.join("/");
}

/** slug-safe stable id for a route pattern. Dynamic segments keep a `d_` marker so
 *  `/x/[id]` and a static sibling `/x/id` never collapse to the same id. */
export function routeId(route) {
  if (route === "/") return "home";
  return route
    .replace(/^\//, "")
    .split("/")
    .map((seg) => (seg.startsWith("[") ? "d_" + seg.replace(/[[\].]/g, "").replace(/^\.\.\./, "") : seg.replace(/[().]/g, "")))
    .join("__");
}

export function isDynamic(route) {
  return route.includes("[");
}

/** The section/group for a route — delegated to the config's normalized function. */
export function groupFor(route) {
  return cfg().groupsFn(route);
}

/** Is `route` excluded by any config `exclude` pattern? Exact match or descendant
 *  (a pattern "/login" drops "/login" and "/login/anything"). */
export function routeExcluded(route, patterns = cfg().exclude) {
  if (!route || !patterns || !patterns.length) return false;
  return patterns.some((p) => route === p || route.startsWith(p.endsWith("/") ? p : p + "/"));
}

// ---- Pattern <-> concrete URL -------------------------------------------

/** Build a RegExp that matches concrete paths against a route pattern. */
export function patternToRegex(route) {
  const body = route
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      if (/^\[\[\.\.\..+\]\]$/.test(seg)) return "(?:/.*)?"; // optional catch-all
      if (/^\[\.\.\..+\]$/.test(seg)) return "/.+"; // catch-all
      if (/^\[.+\]$/.test(seg)) return "/[^/]+"; // dynamic
      return "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp("^" + (body || "/") + "/?$");
}

/** Ordered list of dynamic segment names in a route, e.g. ['projectSlug','id']. */
export function paramNames(route) {
  return route
    .split("/")
    .filter((s) => s.startsWith("["))
    .map((s) => s.replace(/[[\].]/g, "").replace(/^\.\.\./, ""));
}

/** Substitute concrete values (by segment name) into a route pattern. Returns null
 *  only when a *dynamic* segment has no value. */
export function fillRoute(route, values) {
  const out = [];
  for (const seg of route.split("/")) {
    if (!seg.startsWith("[")) { out.push(seg); continue; }
    const name = seg.replace(/[[\].]/g, "").replace(/^\.\.\./, "");
    const v = values[name];
    if (v === undefined || v === null || v === "") return null;
    out.push(v);
  }
  return out.join("/");
}

/** Normalize an href/URL to a route-relative path (strip origin, query, hash, trailing /). */
export function normalizePath(href) {
  if (!href) return null;
  let h = href;
  try { if (/^https?:\/\//.test(h)) h = new URL(h).pathname; } catch { /* keep as-is */ }
  if (!h.startsWith("/")) return null;
  h = h.split("#")[0].split("?")[0].replace(/\/+$/, "");
  return h === "" ? "/" : h;
}

/** Pull distinct internal nav targets out of a rendered DOM string. */
export function extractHrefs(dom) {
  const out = new Set();
  for (const m of dom.matchAll(/href="([^"]+)"/g)) {
    const raw = m[1];
    if (!raw.startsWith("/")) continue; // external / anchor
    if (/^\/(_next|__|icon|apple-icon|favicon)/.test(raw)) continue; // assets
    const h = normalizePath(raw);
    if (h) out.add(h);
  }
  return [...out];
}

// ---- JSON IO -------------------------------------------------------------

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function ensureDirs() {
  const { OUT_DIR, SHOTS_DIR, HISTORY_DIR, BUILDS_DIR } = paths();
  for (const d of [OUT_DIR, SHOTS_DIR, HISTORY_DIR, BUILDS_DIR]) fs.mkdirSync(d, { recursive: true });
}
