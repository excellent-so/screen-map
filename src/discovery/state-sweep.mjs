// Screen Map — state-sweep: auto-discover the hidden state-machine screens a route
// walk can't see, WITHOUT a hand-authored flow declaration.
//
// The router walk gives one screenshot per ROUTE. But many routes hide N screens
// behind a state axis on a single route:
//   • a query param the page reads   (/tour?mode=preview&step=3)
//   • a dynamic [param] gated by app state  (/welcome/[step] → info…done)
// A declared flow (`config.flows`) captures these when someone lists each one. This
// module DISCOVERS the axis and its value domain straight from the route's own
// source, so a project the tool has never seen gets those screens with no config.
//
// Two separate questions:
//   1. WHAT the states are  — the param + its value set. Statically discoverable
//      from source (this module). No per-project authoring.
//   2. HOW to force a gated state — a redirect/auth gate needs one escape hatch.
//      That stays a single generic `statePreview` config knob (?<param>=<value>),
//      NOT a per-flow declaration. Query-param routes that honor their own params
//      (the common case) need nothing at all.
//
// Inference is a best-effort source scan (regex, not a TS parser) tuned to the
// idioms these state machines actually use; when it can't infer a confident
// domain it emits nothing (the route stays a single default screen — never a
// wrong guess). Pure inference helpers are exported for unit tests.

import fs from "node:fs";
import path from "node:path";
import { cfg, env } from "../env.mjs";
import { routeId, groupFor } from "../lib.mjs";
import { readCoLocated } from "./next-app-router.mjs";

// ---- config normalization ------------------------------------------------

/** Normalize `config.stateSweep` (bool | object) → { enabled, maxPerRoute, maxTotal }. */
export function sweepConfig() {
  const raw = cfg().stateSweep;
  if (raw === false) return { enabled: false, maxPerRoute: 0, maxTotal: 0 };
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: o.enabled !== false, // default ON
    maxPerRoute: Number.isFinite(o.maxPerRoute) ? Math.max(1, o.maxPerRoute) : 24,
    maxTotal: Number.isFinite(o.maxTotal) ? Math.max(1, o.maxTotal) : 400,
  };
}

/** Normalize `config.statePreview` (null | string | {param,value}) → {param,value} | null. */
export function previewConfig() {
  const raw = cfg().statePreview;
  if (!raw) return null;
  if (typeof raw === "string") return { param: raw, value: "1" };
  if (typeof raw === "object" && raw.param) return { param: raw.param, value: raw.value == null ? "1" : String(raw.value) };
  return null;
}

// ---- pure source scanners (exported for tests) ---------------------------

const IDENT = "[A-Za-z_$][\\w$]*";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The query-param names a page reads from `searchParams`. Catches the three forms
 * these pages use: an object-type annotation, a destructure, and `.get("x")`.
 */
export function readsSearchParams(pageSrc) {
  if (!pageSrc) return [];
  const names = new Set();
  // 1. type annotation: `searchParams: Promise<{ mode?: string; slide?: string }>`
  for (const m of pageSrc.matchAll(/searchParams\s*[?:]\s*(?:Promise\s*<\s*)?\{([^{}]*)\}/g)) {
    for (const k of m[1].matchAll(new RegExp(`(${IDENT})\\s*[?:]`, "g"))) names.add(k[1]);
  }
  // 2. destructure: `const { mode, slide } = await searchParams`
  for (const m of pageSrc.matchAll(/\{([^{}]*)\}\s*=\s*(?:await\s+)?(?:props\.)?searchParams\b/g)) {
    for (const k of m[1].split(",")) {
      const name = k.split(":")[0].split("=")[0].trim().replace(/^\.\.\./, "");
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // 3. client hook: `searchParams.get("view")` / `params.get('tab')`
  for (const m of pageSrc.matchAll(/\.get\(\s*["'`]([\w-]+)["'`]/g)) names.add(m[1]);
  return [...names];
}

/** All `type X = "a" | "b" | ...` string-union types in source → { X: [values] }. */
export function unionTypes(src) {
  const out = {};
  for (const m of src.matchAll(new RegExp(`type\\s+(${IDENT})\\s*=\\s*([^;]*?);`, "g"))) {
    const body = m[2];
    if (!/\|/.test(body) && !/^\s*["'`]/.test(body)) continue;
    const vals = [...body.matchAll(/["'`]([\w-]+)["'`]/g)].map((x) => x[1]);
    // Require it to be a pure union of string literals (no other tokens between them).
    const stripped = body.replace(/["'`][\w-]+["'`]/g, "").replace(/[|\s]/g, "");
    if (vals.length >= 2 && stripped === "") out[m[1]] = vals;
  }
  return out;
}

/** The inner text of an array literal `const NAME = [ ... ]` (bracket-matched), or null. */
export function arrayInner(src, name) {
  // The optional `: Type` annotation may itself contain brackets (`SlideDef[]`),
  // so match up to the first `=` non-greedily rather than excluding `[`.
  const decl = new RegExp(`\\b${esc(name)}\\b\\s*(?::[^=]*?)?=\\s*\\[`);
  const m = decl.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length - 1; // position of the opening '['
  let depth = 0, inStr = null, start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === inStr && src[i - 1] !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") { if (--depth === 0) return src.slice(start + 1, i); }
  }
  return null;
}

/** Split an array-literal inner text into its top-level element strings. */
export function topLevelElements(inner) {
  if (inner == null) return [];
  const out = [];
  let depth = 0, inStr = null, cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) { cur += c; if (c === inStr && inner[i - 1] !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** If a named array is a list of string literals, its unquoted values; else null. */
export function stringArrayElements(src, name) {
  const els = topLevelElements(arrayInner(src, name));
  if (!els.length) return null;
  const vals = [];
  for (const e of els) {
    const m = /^["'`]([\w-]+)["'`]$/.exec(e);
    if (!m) return null; // not a pure string-literal array
    vals.push(m[1]);
  }
  return vals;
}

/** The top-level element COUNT of a named array literal (for numeric index axes). */
export function arrayLength(src, name) {
  const inner = arrayInner(src, name);
  if (inner == null) return null;
  return topLevelElements(inner).length || null;
}

/** Enum-ish string arrays in scope: an ALL_CAPS `const NAME = ["…"]` (the `as const`
 *  canonical-set idiom, e.g. AUTH_PREVIEW_STATES / VALID_STEPS). { NAME: [values] }. */
export function enumArraysInScope(src) {
  const out = {};
  for (const m of src.matchAll(new RegExp(`\\bconst\\s+(${IDENT})\\s*(?::[^=]*?)?=\\s*\\[`, "g"))) {
    const name = m[1];
    if (!/^[A-Z][A-Z0-9_]+$/.test(name)) continue; // enum-ish: ALL_CAPS/snake only
    const vals = stringArrayElements(src, name);
    if (vals && vals.length >= 2) out[name] = vals;
  }
  return out;
}

/** Distinct string literals compared against `param` via ===/==/switch-case. */
function equalityLiterals(src, param) {
  const p = esc(param);
  const found = new Set();
  for (const m of src.matchAll(new RegExp(`${p}\\s*===?\\s*["'\`]([\\w-]+)["'\`]`, "g"))) found.add(m[1]);
  for (const m of src.matchAll(new RegExp(`["'\`]([\\w-]+)["'\`]\\s*===?\\s*${p}\\b`, "g"))) found.add(m[1]);
  return [...found];
}

/** Does the source treat `param` (or its `initial<Param>` prop echo) as numeric? */
function looksNumeric(src, param) {
  const p = esc(param), ip = esc("initial" + cap(param));
  return new RegExp(`(?:Number|parseInt|parseFloat)\\(\\s*(?:${p}|${ip})\\b`).test(src) ||
    new RegExp(`\\b${p}\\s*[-+]\\s*1\\b`).test(src);
}

/**
 * Infer a param's value domain from its route's co-located source.
 * Returns { kind:"enum"|"numeric", values:[...strings], via } or null (no confident
 * domain — caller emits no state for it). Value order is source order.
 */
export function inferDomain(param, src, { dynamic = false } = {}) {
  const ip = "initial" + cap(param); // page → client prop naming echo (initialMode ← mode)

  // (a) String-union TS type linked to the param (a tour's `mode`: type Mode): the param is
  //     declared with that type (`searchParams: Promise<{ tab?: Tab }>`), or compared to one of
  //     its values, or seeds a useState of it.
  const unions = unionTypes(src);
  for (const [typeName, vals] of Object.entries(unions)) {
    const typed = new RegExp(`\\b(?:${esc(param)}|${esc(ip)})\\s*\\??\\s*:\\s*${esc(typeName)}\\b`).test(src);
    const linked = typed || vals.some((v) =>
      new RegExp(`(?:${esc(param)}|${esc(ip)})\\s*===?\\s*["'\`]${esc(v)}["'\`]`).test(src) ||
      new RegExp(`useState\\s*<[^>]*>\\s*\\(\\s*(?:${esc(param)}|${esc(ip)})\\b`).test(src),
    );
    if (linked) return { kind: "enum", values: vals, via: "union-type" };
  }

  // (b) `ARR.includes(param)` — the app's own allow-list (a wizard's VALID_STEPS).
  const inc = new RegExp(`(${IDENT})\\.includes\\(\\s*${esc(param)}\\b`).exec(src);
  if (inc) {
    const vals = stringArrayElements(src, inc[1]);
    if (vals && vals.length) return { kind: "enum", values: vals, via: "includes-array" };
  }

  // (c) Named allow-list array whose name echoes the param (STEPS / VALID_STEPS).
  for (const nm of arrayNameCandidates(param)) {
    const vals = stringArrayElements(src, nm);
    if (vals && vals.length) return { kind: "enum", values: vals, via: "named-array" };
  }

  // (d) Numeric index axis: `ARR[param]` (+ a numeric signal) → 0..len-1 (slide/step).
  if (looksNumeric(src, param)) {
    const idx = new RegExp(`(${IDENT})\\[\\s*${esc(param)}\\s*\\]`).exec(src);
    const arrName = idx ? idx[1]
      : (new RegExp(`${esc(param)}\\s*[<%=]=?\\s*(${IDENT})\\.length`).exec(src)
        || new RegExp(`(${IDENT})\\.length\\s*[-)]`).exec(src) || [])[1];
    const len = arrName ? arrayLength(src, arrName) : null;
    if (len && len > 1) return { kind: "numeric", values: range(len), via: "index-array" };
  }

  // (e) Equality checks — but the app often compares against only a SUBSET of the
  //     canonical set. If the compared literals all belong to one ALL_CAPS enum
  //     array, adopt the FULL array (auth's mode → AUTH_PREVIEW_STATES: 4 checks,
  //     6 real states). Else fall back to just the compared literals.
  const lits = equalityLiterals(src, param);
  if (lits.length >= 1) {
    for (const [, vals] of Object.entries(enumArraysInScope(src))) {
      if (vals.length > lits.length && lits.every((l) => vals.includes(l))) {
        return { kind: "enum", values: vals, via: "enum-superset" };
      }
    }
  }
  if (lits.length >= 2) return { kind: "enum", values: lits, via: "equality" };

  // (f) Named allow-list even for dynamic params with no other signal.
  if (dynamic) {
    for (const nm of ["VALID_" + param.toUpperCase() + "S", param.toUpperCase() + "S"]) {
      const vals = stringArrayElements(src, nm);
      if (vals && vals.length) return { kind: "enum", values: vals, via: "named-array" };
    }
  }
  return null;
}

function arrayNameCandidates(param) {
  const U = param.toUpperCase();
  return [`${U}S`, `VALID_${U}S`, `${U}_VALUES`, `ALL_${U}S`, param + "s", param.toUpperCase()];
}
function range(n) { return Array.from({ length: n }, (_, i) => String(i)); }

// ---- the sweep -----------------------------------------------------------

function readPageSrc(s) {
  if (!s.file) return "";
  try { return fs.readFileSync(path.join(env().root, s.file), "utf8"); } catch { return ""; }
}

/** Should this base screen be left out of the sweep entirely? */
function skip(s) {
  return Boolean(
    s.flow ||            // a declared flow already owns this route
    s.state ||           // already swept
    s.crawlOnly ||       // runtime-only synthesized node (no source)
    s.coldOnly,
  );
}

function slug(v) { return String(v).replace(/[^\w-]+/g, "-"); }

/**
 * Auto-discover state-machine screens and fan them into `screens` IN PLACE. A
 * dynamic-[param] axis REPLACES its base (the pattern node was never a real screen);
 * a query-param axis KEEPS the base (the bare URL is the real default state) and
 * ADDS siblings. Returns { swept, routes, truncated }.
 */
export function sweepParamStates(screens, { log = () => {} } = {}) {
  const conf = sweepConfig();
  if (!conf.enabled) return { swept: 0, routes: 0, truncated: 0 };
  const preview = previewConfig();
  const previewParam = preview ? preview.param : null;

  let swept = 0, routes = 0, truncated = 0;
  // Snapshot the base list — we mutate `screens` as we go.
  for (const base of [...screens]) {
    if (skip(base)) continue;
    const idx = screens.indexOf(base);
    if (idx === -1) continue; // already spliced out

    const src = readPageSrc(base) + "\n" + readCoLocated(base.file);
    const pageSrc = readPageSrc(base);

    // Which params carry state? Dynamic [param]s first, then read query params
    // (minus the forcing param itself, which is machinery, not a state axis).
    const dynParams = base.dynamic ? (base.params || []) : [];
    const queryParams = readsSearchParams(pageSrc).filter(
      (p) => p !== previewParam && !dynParams.includes(p),
    );

    // A dynamic route: sweep its FIRST [param] as path states (replaces the base).
    if (dynParams.length === 1) {
      const dom = inferDomain(dynParams[0], src, { dynamic: true });
      if (dom) {
        const gated = needsPreview(base, src);
        const states = pathStates(base, dynParams[0], dom, conf, preview, gated);
        truncated += states.truncated;
        screens.splice(idx, 1, ...states.screens);
        swept += states.screens.length; routes++;
        log(`  sweep: ${base.route} → ${states.screens.length} steps [${dynParams[0]} · ${dom.via}]`);
        continue; // base replaced; query params on a wizard page are machinery
      }
    }

    // A static route: sweep each query param as sibling states (base kept).
    if (!base.dynamic && queryParams.length) {
      const gated = needsPreview(base, src);
      let added = [];
      for (const p of queryParams) {
        const dom = inferDomain(p, src, { dynamic: false });
        if (!dom) continue;
        const st = queryStates(base, p, dom, conf, preview, gated, added.length);
        truncated += st.truncated;
        added = added.concat(st.screens);
        if (added.length >= conf.maxTotal) break;
      }
      if (added.length) {
        screens.splice(idx + 1, 0, ...added);
        swept += added.length; routes++;
        const axes = [...new Set(added.map((s) => s.state.param))].join(", ");
        log(`  sweep: ${base.route} + ${added.length} states [${axes}]`);
      }
    }
    if (swept >= conf.maxTotal) { log(`  sweep: hit maxTotal ${conf.maxTotal} — stopping`); break; }
  }
  if (swept) log(`  sweep: +${swept} auto-discovered state screens across ${routes} routes${truncated ? ` (${truncated} values truncated by cap)` : ""}`);
  return { swept, routes, truncated };
}

/** A route is gated when it redirects/notFounds at the top of the page (needs the escape hatch). */
function needsPreview(base, src) {
  return /\b(?:redirect|notFound)\s*\(/.test(src);
}

function applyPreview(query, preview, gated) {
  if (!preview || !gated) return query;
  return { [preview.param]: preview.value, ...query };
}

function toUrl(route, query) {
  const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return qs ? `${route}?${qs}` : route;
}

function pathStates(base, param, dom, conf, preview, gated) {
  const vals = dom.values.slice(0, conf.maxPerRoute);
  const truncated = dom.values.length - vals.length;
  const grp = base.group || groupFor(base.route);
  const screens = vals.map((v, i) => {
    const route = base.route.replace(`[${param}]`, v);
    const query = applyPreview({}, preview, gated);
    return stateScreen({
      id: routeId(route), route, title: `${base.route} · ${v}`,
      base, grp, url: toUrl(route, query),
      state: { param, value: v, kind: "path", via: dom.via, index: i, first: i === 0, last: i === vals.length - 1 },
    });
  });
  chain(screens);
  return { screens, truncated };
}

function queryStates(base, param, dom, conf, preview, gated, already) {
  const room = Math.max(0, conf.maxPerRoute);
  const vals = dom.values.slice(0, room);
  const truncated = dom.values.length - vals.length;
  const grp = base.group || groupFor(base.route);
  const screens = vals.map((v, i) => {
    const query = applyPreview({ [param]: v }, preview, gated);
    return stateScreen({
      id: `${base.id}__${slug(param)}-${slug(v)}`,
      route: base.route, title: `${base.route} · ${param}=${v}`,
      base, grp, url: toUrl(base.route, query),
      state: { param, value: v, kind: "query", via: dom.via, index: i, first: i === 0, last: i === vals.length - 1, baseId: base.id },
    });
  });
  chain(screens, base.id);
  return { screens, truncated };
}

function stateScreen({ id, route, title, base, grp, url, state }) {
  return {
    id, route, title,
    file: base.file,
    group: grp,
    dynamic: false,
    params: [],
    capabilities: base.capabilities || { hasLoading: false, hasColdStart: false, hasError: false },
    url,
    resolved: true,
    resolveNote: `state:${state.param}=${state.value}`,
    redirectTo: null,
    states: [],
    discoveredBy: ["state-sweep"],
    state,
  };
}

/** Give a run of state screens a prev/next chain (+ optional entry from a base). */
function chain(screens, entryId) {
  for (let i = 0; i < screens.length; i++) {
    screens[i].state.prevId = i > 0 ? screens[i - 1].id : null;
    screens[i].state.nextId = i < screens.length - 1 ? screens[i + 1].id : null;
  }
  if (entryId && screens[0]) screens[0].state.entryId = entryId;
}

/** Ordered state-axis edges (base→first, step→step+1) — mirror of flowEdges. Called from graph. */
export function stateEdges(screens, addEdge) {
  for (const s of screens) {
    const st = s.state;
    if (!st) continue;
    if (st.entryId) addEdge(st.entryId, s.id, "step", "state-sweep");
    if (st.nextId) addEdge(s.id, st.nextId, "step", "state-sweep");
  }
}
