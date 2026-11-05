// Screen Map — discovery adapter: Next.js App Router.
//
// Enumerates EVERY route from the filesystem router — including orphan pages a
// link-crawler structurally cannot find. Framework-specific by construction; the
// first DiscoveryAdapter.

import fs from "node:fs";
import path from "node:path";
import { env, appDirAbs, cfg } from "../env.mjs";
import {
  findPageFiles, routeForFile, routeId, isDynamic, groupFor, paramNames, patternToRegex,
} from "../lib.mjs";

/** Does a loading/error/not-found file exist for this dir or an ancestor within app/? */
function ancestorHas(dir, filename, appDir) {
  let d = dir;
  while (d.startsWith(appDir)) {
    if (fs.existsSync(path.join(d, filename))) return true;
    d = path.dirname(d);
  }
  return false;
}

/** Static source-scan patterns — literal nav targets in page/component source. */
const EDGE_PATTERNS = [
  [/href=["'`](\/[^"'`?#]*)/g, "link"],
  [/href=\{`(\/[^`?#]*)/g, "link"],
  [/href=\{["'](\/[^"'?#]*)/g, "link"],
  [/router\.(?:push|replace)\(\s*[`"'](\/[^`"'?#]*)/g, "push"],
  [/\bredirect\(\s*[`"'](\/[^`"'?#]*)/g, "redirect"],
  [/nav_?[tT]o\(\s*[`"'](\/[^`"'?#]*)/g, "nav"],
];

export const name = "next-app-router";

/** The router walk: filesystem → screen list. */
export function enumerate() {
  const appDir = appDirAbs();
  const root = env().root;
  const coldRe = cfg().coldStartPattern; // optional; off when null
  const screens = [];
  const seen = new Set();
  for (const file of findPageFiles(appDir)) {
    const route = routeForFile(file, appDir);
    if (route === null) continue;
    if (seen.has(route)) continue;
    seen.add(route);

    const dir = path.dirname(file);
    let src = "";
    try { src = fs.readFileSync(file, "utf8"); } catch { /* ignore */ }

    const dynamic = isDynamic(route);
    screens.push({
      id: routeId(route),
      route,
      file: path.relative(root, file),
      group: groupFor(route),
      dynamic,
      params: paramNames(route),
      capabilities: {
        // Own-dir loading only: a root app/loading wraps every route, so
        // ancestor-matching would mislabel every route as having a loading state.
        hasLoading: fs.existsSync(path.join(dir, "loading.tsx")) || fs.existsSync(path.join(dir, "loading.jsx")),
        hasColdStart: coldRe ? coldRe.test(src) : false,
        hasError: ancestorHas(dir, "error.tsx", appDir) || ancestorHas(dir, "not-found.tsx", appDir),
      },
      url: dynamic ? null : route,
      resolved: !dynamic,
      resolveNote: null,
      states: [],
      discoveredBy: ["router-walk"],
    });
  }
  screens.sort((a, b) => a.route.localeCompare(b.route));
  return screens;
}

// ---- Static edge derivation (co-located source scan) ---------------------

function normalizeTarget(t) {
  t = t.split("#")[0].split("?")[0];
  t = t.replace(/\$\{[^}]*\}/g, "x").replace(/\[[^\]]*\]/g, "x");
  if (!t.startsWith("/")) return null;
  t = t.replace(/\/+$/, "");
  return t === "" ? "/" : t;
}

function specificity(route) {
  return route.split("/").filter(Boolean).map((s) => (/^\[\[?\.\.\./.test(s) ? 2 : s.startsWith("[") ? 1 : 0));
}
function moreSpecific(a, b) {
  const sa = specificity(a.route), sb = specificity(b.route);
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    const x = sa[i] ?? 9, y = sb[i] ?? 9;
    if (x !== y) return x < y;
  }
  return a.route.length < b.route.length;
}

/** Match a concrete/literal target to the most-specific known route id. */
export function matchRouteId(target, screens) {
  const norm = normalizeTarget(target);
  if (!norm) return null;
  const exact = screens.find((s) => !s.dynamic && s.route === norm);
  if (exact) return exact.id;
  let best = null;
  for (const s of screens) {
    if (!patternToRegex(s.route).test(norm)) continue;
    if (!best || moreSpecific(s, best)) best = s;
  }
  return best ? best.id : null;
}

export function readCoLocated(screenFile) {
  if (!screenFile) return "";
  const dir = path.join(env().root, path.dirname(screenFile));
  const sources = [];
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isFile() && /\.(tsx|ts|jsx|js)$/.test(ent.name)) {
        try { sources.push(fs.readFileSync(path.join(dir, ent.name), "utf8")); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return sources.join("\n");
}

/**
 * Derive static nav edges by scanning each screen's co-located source for literal
 * targets — catches programmatic router.push()/redirect() the rendered DOM has no
 * <a href> for. Returns [{ from, to, kind, source:"src" }].
 */
export function deriveStaticEdges(screens) {
  const out = [];
  const push = (from, to, kind) => { if (to && to !== from) out.push({ from, to, kind, source: "src" }); };
  for (const s of screens) {
    if (s.flow?.step) continue; // fanned flow steps share one file — edges come from flow/DOM
    if (s.state) continue; // swept state screens share the base's file — base carries the edges
    const src = readCoLocated(s.file);
    if (!src) continue;
    for (const [re, kind] of EDGE_PATTERNS) {
      for (const m of src.matchAll(re)) push(s.id, matchRouteId(m[1], screens), kind);
    }
  }
  return out;
}
