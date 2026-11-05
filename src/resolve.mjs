// Screen Map — resolve: turn dynamic route patterns into concrete URLs.
//
// Two layers:
//   1. Static — substitute seed values from config.sampleParams (fast, offline).
//   2. DOM    — for anything still open, render the nearest index page with Chrome
//               --dump-dom and scrape a real detail link (self-maintaining).
// Whatever can't be resolved stays a node, marked unresolved (honest greying).

import { cfg, devBaseUrl, paths } from "./env.mjs";
import { fillRoute, patternToRegex, paramNames, readJson } from "./lib.mjs";
import { dumpDom } from "./browser.mjs";

/** Merge config.sampleParams with an optional .screenmap/sample-params.json override. */
function loadSample() {
  const base = cfg().sampleParams && typeof cfg().sampleParams === "object" ? cfg().sampleParams : {};
  const override = readJson(paths().SAMPLE_PARAMS_FILE, {});
  const merged = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (Array.isArray(v)) merged[k] = [...new Set([...(v || []), ...(merged[k] || [])])];
  }
  return merged;
}

function firstValues(sample) {
  const out = {};
  for (const [k, v] of Object.entries(sample)) if (Array.isArray(v) && v.length) out[k] = v[0];
  return out;
}

/** The deepest index URL reachable with known params (stops at first unknown seg). */
function indexSourceUrl(route, firsts) {
  const out = [];
  for (const seg of route.split("/").filter(Boolean)) {
    if (seg.startsWith("[")) {
      const name = seg.replace(/[[\].]/g, "").replace(/^\.\.\./, "");
      const val = firsts[name];
      if (val == null) break;
      out.push(val);
    } else out.push(seg);
  }
  return "/" + out.join("/");
}

function extractParams(route, concrete) {
  const rs = route.split("/").filter(Boolean);
  const cs = concrete.split("/").filter(Boolean);
  const vals = {};
  for (let i = 0; i < rs.length; i++) {
    if (!rs[i].startsWith("[")) continue;
    const name = rs[i].replace(/[[\].]/g, "").replace(/^\.\.\./, "");
    vals[name] = /^\[\[?\.\.\./.test(rs[i]) ? cs.slice(i).join("/") : cs[i];
  }
  return vals;
}

// Tails that are client-side actions/modals with no backing page — never a record id.
const ACTION_TAILS = new Set(["new", "create", "import", "export", "bulk"]);

function hrefsFromDom(dom) {
  const out = new Set();
  for (const m of dom.matchAll(/href="([^"]+)"/g)) {
    let h = m[1];
    if (!h.startsWith("/")) continue;
    if (h.startsWith("/_next") || h.startsWith("/__")) continue;
    h = h.split("#")[0].split("?")[0];
    if (h.length > 1) out.add(h.replace(/\/$/, ""));
  }
  return [...out];
}

export async function resolveScreens(screens, opts = {}) {
  const { resolveDom = true, log = () => {} } = opts;
  const sample = loadSample();
  const firsts = firstValues(sample);
  const staticRoutes = new Set(screens.filter((s) => !s.dynamic).map((s) => s.route));
  const base = devBaseUrl();

  // Layer 0: route-URL PINS (config.routeUrls + a .screenmap/route-urls.json override),
  // route PATTERN → concrete URL, highest priority. The escape hatch for makeable
  // dynamic routes the DOM harvest can't reach (overloaded `[id]`, no scrapeable index,
  // section-scoped route whose index lives elsewhere).
  const cfgPins = cfg().routeUrls && typeof cfg().routeUrls === "object" ? cfg().routeUrls : {};
  const routeUrls = { ...cfgPins, ...readJson(paths().ROUTE_URLS_FILE, {}) };
  let pinCount = 0;
  for (const s of screens) {
    if (!s.dynamic) continue;
    const pin = routeUrls[s.route];
    if (typeof pin === "string" && pin.startsWith("/")) { s.url = pin; s.resolved = true; s.resolveNote = "pinned"; pinCount++; }
  }
  if (pinCount) log(`resolve: ${pinCount} dynamic routes pinned from route-urls`);

  // Layer 1: static substitution.
  let staticCount = 0;
  for (const s of screens) {
    if (!s.dynamic || s.resolved) continue;
    const url = fillRoute(s.route, firsts);
    if (url) { s.url = url; s.resolved = true; s.resolveNote = "static"; staticCount++; }
  }
  log(`resolve: ${staticCount} dynamic routes filled from seed values`);

  const open = screens.filter((s) => s.dynamic && !s.resolved);
  if (!resolveDom || !open.length) {
    log(`resolve: ${open.length} unresolved${resolveDom ? "" : " (dom-resolve off)"}`);
    return screens;
  }

  // Layer 2: DOM harvest. Render each unique index page once, reuse for all screens rooted there.
  const bySource = new Map();
  for (const s of open) {
    const src = indexSourceUrl(s.route, firsts);
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(s);
  }
  log(`resolve: dom-harvesting ${bySource.size} index pages for ${open.length} routes…`);

  let domCount = 0;
  for (const [src, group] of bySource) {
    let hrefs = [];
    try {
      const dom = await dumpDom(base + src, { profile: "domR" });
      hrefs = hrefsFromDom(dom);
    } catch { /* ignore, leave unresolved */ }
    for (const s of group) {
      const re = patternToRegex(s.route);
      const hit = hrefs.find((h) => {
        if (!re.test(h) || staticRoutes.has(h)) return false;
        const last = h.split("/").filter(Boolean).pop();
        return !ACTION_TAILS.has(last);
      });
      if (!hit) continue;
      const vals = extractParams(s.route, hit);
      const url = fillRoute(s.route, { ...firsts, ...vals });
      if (url) { s.url = url; s.resolved = true; s.resolveNote = "dom"; domCount++; }
    }
  }
  log(`resolve: ${domCount} more resolved via DOM; ${open.length - domCount} still unresolved`);
  for (const s of open) if (!s.resolved) s.resolveNote = `unresolved (${(s.params || paramNames(s.route)).join(",")})`;
  return screens;
}
