// Screen Map — build: run the whole pipeline and emit the artifact.
// enumerate(walk) → flows → resolve → capture → crawl∪walk → capture crawl-found → graph → screenmap.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, paths, devBaseUrl } from "./env.mjs";
import { ensureDirs, readJson, writeJson, routeExcluded } from "./lib.mjs";
import { getDiscoveryAdapter, unionCrawl, walkCovers } from "./discovery/index.mjs";
import { crawl as runCrawl } from "./discovery/crawl.mjs";
import { expandFlows } from "./flows.mjs";
import { sweepParamStates } from "./discovery/state-sweep.mjs";
import { resolveScreens } from "./resolve.mjs";
import { buildGraph } from "./graph.mjs";
import { captureAll, linksFromCapture } from "./capture.mjs";
import { screenshot, hasChrome } from "./browser.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWER_SRC = path.join(PKG_ROOT, "viewer", "index.html");
const log = (m) => console.log(m);

/** The discovery adapter for the configured framework, or a hard error. */
function adapterOrThrow() {
  const framework = env().config.framework;
  const adapter = getDiscoveryAdapter(framework);
  if (!adapter) {
    throw new Error(
      `Unknown framework "${framework}". Known: next-app-router. ` +
      `Set \`framework\` in screen-map.config.* (or use discovery:["crawl"] for portability).`,
    );
  }
  return adapter;
}

/** The navigation graph over `screens`: their own links, the source scan and the crawl's edges. */
function graphOf(screens, crawlEdges = []) {
  const adapter = getDiscoveryAdapter(env().config.framework);
  const staticEdges = adapter?.deriveStaticEdges ? adapter.deriveStaticEdges(screens) : [];
  return buildGraph(screens, { staticEdges, crawlEdges });
}

// ---- capture history -------------------------------------------------------

const defaultShot = (s) => (s.states || []).find((x) => x.state === "default" && x.ok && x.shot) || null;

/** Each screen's default capture in the last map written (a recapture updates that map, not prev.json). */
function priorShots() {
  const { MAP_FILE, BUILDS_DIR } = paths();
  const pick = (f) => { const m = readJson(f, null); return Array.isArray(m?.screens) ? m : null; };
  const prev = pick(MAP_FILE) || pick(path.join(BUILDS_DIR, "prev.json"));
  const out = new Map();
  for (const s of prev?.screens || []) { const st = defaultShot(s); if (st) out.set(s.id, st); }
  return out;
}

/** Keep the before/after history a recapture built up; a shot the build reused keeps its time too. */
function keepHistory(screens, prior) {
  for (const s of screens) {
    const st = defaultShot(s), was = prior.get(s.id);
    if (!st || !was || st.shot !== was.shot) continue;
    if (!st.history && Array.isArray(was.history) && was.history.length) st.history = was.history;
    if (st.cached && !st.capturedAt && was.capturedAt) {
      st.capturedAt = was.capturedAt;
      if (was.recaptured) st.recaptured = true;
    }
  }
}

/** Distinct groups in stable first-appearance order. */
function groupsFromScreens(screens) {
  const seen = [];
  for (const s of screens) if (s.group && !seen.includes(s.group)) seen.push(s.group);
  return seen;
}

// ---- regraph (Chrome-free reuse) -----------------------------------------

function reuseStates(s, prev, SHOTS_DIR) {
  const outAbs = path.join(SHOTS_DIR, `${s.id}.default.png`);
  const pageAbs = s.file ? path.join(env().root, s.file) : null;
  let freshShot = null;
  try {
    const pageM = pageAbs && fs.existsSync(pageAbs) ? fs.statSync(pageAbs).mtimeMs : 0;
    if (fs.existsSync(outAbs) && fs.statSync(outAbs).mtimeMs >= pageM) {
      freshShot = path.relative(path.dirname(SHOTS_DIR), outAbs);
    }
  } catch { /* no shot / no page file */ }
  if (s.flow?.entry) {
    return [{ state: "default", capture: false, cold: true, reason: "redirect hub → flow — captured via `capture-flow`" }];
  }
  if (freshShot) {
    const others = (prev?.states || []).filter((x) => x.state !== "default");
    return [{ state: "default", ok: true, shot: freshShot, cached: true }, ...others];
  }
  if (s.coldOnly || s.flow?.coldOnly) {
    return [{ state: "default", capture: false, cold: true, reason: "cold-start only — run `screen-map capture-flow`" }];
  }
  return prev?.states?.length ? prev.states : [];
}

function reuseFromPrev(screens, log2) {
  const { BUILDS_DIR, MAP_FILE, SHOTS_DIR } = paths();
  const pick = (f) => { const p = readJson(f, null); return Array.isArray(p?.screens) ? p : null; };
  const prev = pick(path.join(BUILDS_DIR, "prev.json")) || pick(MAP_FILE);
  if (!prev) {
    log2("  regraph: no usable prior build to reuse — run `screen-map build` first.");
    for (const s of screens) if (!s.states) s.states = [];
    return null;
  }
  const prevById = new Map(prev.screens.map((s) => [s.id, s]));
  // Pages only the crawl found aren't in the walk: keep the last build's, with their shots.
  const walk = screens.slice();
  const exclude = env().config.exclude || [];
  for (const p of prev.screens) {
    if (p.crawlOnly && !walkCovers(walk, p.route) && !routeExcluded(p.route, exclude)) screens.push({ ...p });
  }
  let shots = 0;
  for (const s of screens) {
    const p = prevById.get(s.id);
    if (p && !s.resolved) { s.url = p.url; s.resolved = p.resolved; s.resolveNote = p.resolveNote; }
    if (s.redirectTo == null && p) s.redirectTo = p.redirectTo || null;
    s.states = reuseStates(s, p, SHOTS_DIR);
    if ((s.states || []).some((x) => x.ok)) shots++;
  }
  log2(`  regraph: reused ${prevById.size} prior screens · ${shots} shots attached (no Chrome)`);
  return prev;
}

// ---- pages only the crawl found -------------------------------------------

/**
 * Screenshot the pages only the crawl found, with the same capture as the walk's routes.
 * They have no source file to tell whether they changed, so every build takes them again.
 * At most `max` of them (config.crawlCaptureMax), nearest `/` first, within what is left
 * of a --limit. URLs that aren't pages (`page: false`) keep their reason and no shot.
 */
async function captureCrawlFound(screens, { max, limitLeft, capture }) {
  const pages = screens.filter((s) => s.crawlOnly && s.page);
  if (!pages.length) return;
  const budget = Math.min(max, limitLeft);
  if (budget <= 0) {
    log(`• capture: pages only the crawl found (skipped: ${max <= 0 ? "crawlCaptureMax is 0" : "--limit reached"})`);
    return;
  }
  log("• capture: pages only the crawl found");
  const wanted = capture.only && capture.only.length ? pages.filter((s) => capture.only.includes(s.group)).length : pages.length;
  await captureAll(pages, { ...capture, force: true, limit: Number.isFinite(budget) ? budget : 0 });
  if (budget === max && wanted > max) {
    log(`  ${wanted - max} more crawl-found page(s) have no screenshot: crawlCaptureMax is ${max} (raise it in the config, or pass --crawl-capture-max=N)`);
  }
}

// ---- the main build ------------------------------------------------------

export async function runBuild(opts = {}) {
  ensureDirs();
  const { OUT_DIR, BUILDS_DIR, MAP_FILE, NOTES_FILE, LINKS_FILE, HISTORY_DIR } = paths();
  const t0 = Date.now();
  const adapter = adapterOrThrow();
  const prior = priorShots();

  log("• enumerate (router-walk)");
  let screens = adapter.enumerate();
  expandFlows(screens);        // declared flows (explicit override, if any)
  if (!opts.noStateSweep) sweepParamStates(screens, { log }); // auto-discovered state screens (the general path)
  const exclude = env().config.exclude || [];
  if (exclude.length) {
    const before = screens.length;
    screens = screens.filter((s) => !routeExcluded(s.route, exclude));
    if (before > screens.length) log(`  exclude: dropped ${before - screens.length} screen(s) matching ${exclude.join(", ")}`);
  }
  log(`  ${screens.length} screens (${screens.filter((s) => s.dynamic).length} dynamic)`);

  const capture = {
    states: opts.states || ["default", "loading"],
    concurrency: opts.concurrency || 2, only: opts.only || null, log,
    retryFailed: Boolean(opts.retryFailed),
  };
  let walkTargets = 0;
  let prevProven = [], prevCrawlOnly = [];
  if (opts.reuse) {
    log("• regraph (reuse resolutions + on-disk shots)");
    const prev = reuseFromPrev(screens, log);
    prevProven = prev?.provenOrphans || [];
    prevCrawlOnly = prev?.crawlOnly || [];
  } else {
    log("• resolve");
    // DOM-resolve needs Chrome + a running server (like capture), so --no-capture
    // implies a fast, offline, Chrome-free resolve (static substitution only).
    const doResolveDom = opts.resolveDom !== false && !opts.noCapture;
    await resolveScreens(screens, { resolveDom: doResolveDom, log });

    if (!opts.noCapture) {
      log("• capture");
      const res = await captureAll(screens, { ...capture, force: opts.force, limit: opts.limit || 0 });
      walkTargets = res.screens;
    } else {
      log("• capture (skipped)");
      for (const s of screens) if (!s.states || !s.states.length) {
        s.states = (s.coldOnly || s.flow?.coldOnly)
          ? [{ state: "default", capture: false, cold: true, reason: "cold-start only — run `screen-map capture-flow`" }]
          : [];
      }
    }
  }

  // Feed the graph real nav links from this run's capture, or the persisted cache.
  const linksCache = readJson(LINKS_FILE, {});
  for (const s of screens) {
    if (s.outLinks == null && s.redirectTo == null && linksCache[s.id]) {
      s.outLinks = linksCache[s.id].outLinks || [];
      s.redirectTo = linksCache[s.id].redirectTo || null;
    }
  }

  // ── Discovery union: running-server crawl ∪ router-walk ──────────────────
  const wantCrawl = env().config.discovery.includes("crawl") && !opts.noCrawl && !opts.reuse && !opts.noCapture;
  let provenOrphans = prevProven, crawlOnly = prevCrawlOnly, crawlEdges = [], crawlRan = false;
  if (wantCrawl && hasChrome()) {
    log("• crawl (running-server, portability + proven-orphan report)");
    const crawlResult = await runCrawl({ maxPages: opts.crawlMax || 200, log });
    const union = unionCrawl(screens, crawlResult);
    screens = exclude.length ? union.screens.filter((s) => !routeExcluded(s.route, exclude)) : union.screens;
    provenOrphans = exclude.length ? union.provenOrphans.filter((id) => screens.some((s) => s.id === id)) : union.provenOrphans;
    crawlOnly = exclude.length ? union.crawlOnly.filter((p) => !routeExcluded(p, exclude)) : union.crawlOnly;
    crawlEdges = union.crawlEdges;
    crawlRan = union.crawlRan;
    log(`  union: +${union.crawlOnly.length} crawl-only · ${union.provenOrphans.length} proven orphans (walk ∖ crawl)`);
  } else if (wantCrawl) {
    log("• crawl (skipped — no Chrome; proven-orphan report unavailable)");
  }
  if (crawlRan) {
    const limitLeft = opts.limit > 0 ? Math.max(0, opts.limit - walkTargets) : Infinity;
    await captureCrawlFound(screens, { max: env().config.crawlCaptureMax, limitLeft, capture });
  }

  keepHistory(screens, prior);

  log("• graph");
  const graph = graphOf(screens, crawlEdges);
  log(`  ${graph.edges.length} edges · ${graph.orphans.length} orphans · ${graph.deadEnds.length} dead-ends`);
  for (const s of screens) delete s.outLinks; // encoded in edges; keep the JSON lean

  // Diff against the previous build.
  const prevRaw = readJson(path.join(BUILDS_DIR, "prev.json"), null);
  const prev = Array.isArray(prevRaw?.screens) ? prevRaw : null;
  const prevIds = new Set(prev ? prev.screens.map((s) => s.id) : []);
  const curIds = new Set(screens.map((s) => s.id));
  const added = [...curIds].filter((id) => !prevIds.has(id));
  const removed = prev ? [...prevIds].filter((id) => !curIds.has(id)) : [];
  if (prev) for (const s of screens) s.isNew = added.includes(s.id);

  const buildId = new Date().toISOString().replace(/[:.]/g, "-");
  const resolvedCount = screens.filter((s) => s.resolved).length;
  const capturedCount = screens.filter((s) => (s.states || []).some((x) => x.ok)).length;

  const map = {
    schemaVersion: 2,
    build: {
      id: buildId,
      generatedAt: new Date().toISOString(),
      devBaseUrl: devBaseUrl(),
      framework: env().config.framework,
      discovery: env().config.discovery,
      routeCount: screens.length,
      resolvedCount, capturedCount,
      durationMs: Date.now() - t0,
    },
    groups: groupsFromScreens(screens),
    screens,
    edges: graph.edges,
    orphans: graph.orphans,
    deadEnds: graph.deadEnds,
    // The proven orphan report (walk ∖ crawl-reached) + runtime-only routes (crawl ∖ walk).
    provenOrphans, crawlOnly, crawlRan,
    diff: { added, removed, hadPrevious: Boolean(prev) },
  };

  writeJson(MAP_FILE, map);
  writeJson(path.join(BUILDS_DIR, `${buildId}.json`), map);
  writeJson(path.join(BUILDS_DIR, "prev.json"), map);

  // Copy the viewer next to the data it reads.
  try { fs.copyFileSync(VIEWER_SRC, path.join(OUT_DIR, "index.html")); }
  catch { log("  (viewer template missing — `serve` will still work if index.html exists)"); }

  // Notes: seed if absent, else re-key — a note whose every target screen vanished is
  // ARCHIVED to `stale`, never deleted.
  if (!fs.existsSync(NOTES_FILE)) {
    writeJson(NOTES_FILE, { notes: [], stale: [] });
  } else {
    const nf = readJson(NOTES_FILE, { notes: [], stale: [] });
    const live = [], stale = nf.stale || [];
    for (const n of nf.notes || []) {
      if ((n.screens || []).some((id) => curIds.has(id))) live.push(n);
      else stale.push({ ...n, archivedAt: new Date().toISOString(), archivedBuild: buildId });
    }
    if (stale.length !== (nf.stale || []).length) writeJson(NOTES_FILE, { notes: live, stale });
  }

  log("");
  log(`✓ screen map built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log(`  ${screens.length} screens · ${resolvedCount} resolved · ${capturedCount} captured · ${map.edges.length} edges`);
  if (crawlRan) log(`  proven orphans (walk ∖ crawl): ${provenOrphans.length}`);
  if (prev) log(`  diff: +${added.length} new, −${removed.length} removed since last build`);
  log(`  artifact: ${path.relative(process.cwd(), MAP_FILE)}`);
  log(`  view:     screen-map serve   (then open the printed URL)`);
  return map;
}

/** Capture ONLY a declared flow's step screens (e.g. onboarding) into the map. */
export async function captureFlow(opts = {}) {
  ensureDirs();
  const id = opts.id || "onboarding";
  const adapter = adapterOrThrow();
  log(`• capture-flow: ${id}  (base ${devBaseUrl()})`);
  const screens = adapter.enumerate();
  expandFlows(screens);
  await resolveScreens(screens, { resolveDom: false, log });
  const res = await captureAll(screens, {
    flowOnly: id, states: ["default"], force: opts.force,
    concurrency: opts.concurrency || 2, log,
  });
  log("");
  log(`✓ capture-flow ${id}: ${res.captured} captured, ${res.skipped} cached, ${res.failed} failed.`);
  log("  Now run `screen-map regraph` to fold them into the map.");
  return res;
}

const HISTORY_KEEP = 12;

/**
 * Bring the map's graph up to date after the `retaken` screens were captured again: their
 * fresh links replace what they linked to before (and what the crawl saw from them), so
 * their Orphan and Dead end signals, and their neighbours', are current.
 */
function regraphAfterRecapture(map, retaken) {
  const links = readJson(paths().LINKS_FILE, {});
  for (const s of map.screens) {
    if (retaken.has(s.id) || !links[s.id]) continue;
    s.outLinks = links[s.id].outLinks || [];
    if (s.redirectTo == null) s.redirectTo = links[s.id].redirectTo || null;
  }
  const crawlEdges = (map.edges || [])
    .filter((e) => e.source === "crawl" && !retaken.has(e.from))
    .map((e) => ({ from: e.from, to: e.to, kind: "crawl", source: "crawl" }));
  const graph = graphOf(map.screens, crawlEdges);
  map.edges = graph.edges; map.orphans = graph.orphans; map.deadEnds = graph.deadEnds;
  for (const s of map.screens) delete s.outLinks;
  if (map.build) map.build.capturedCount = map.screens.filter((s) => (s.states || []).some((x) => x.ok)).length;
}

/** Re-screenshot a set of already-resolved screens (by id) in place — the review-loop refresh. */
export async function recaptureIds(ids = [], opts = {}) {
  ensureDirs();
  const { SHOTS_DIR, MAP_FILE, HISTORY_DIR, OUT_DIR, LINKS_FILE } = paths();
  const base = devBaseUrl();
  const conc = Math.max(1, Math.min(4, Number.isFinite(opts.concurrency) ? Math.floor(opts.concurrency) : 2));
  const map = readJson(MAP_FILE, null);
  if (!map || !Array.isArray(map.screens)) {
    return { ok: false, error: "no-build", requested: ids.length, captured: 0, results: [] };
  }
  const byId = new Map(map.screens.map((s) => [s.id, s]));
  const targets = ids.map((id) => byId.get(id)).filter((s) => s && s.resolved && s.url);
  const missing = ids.filter((id) => !byId.get(id)?.resolved || !byId.get(id)?.url);
  const results = missing.map((id) => ({ id, ok: false, error: "unresolved" }));
  const links = readJson(LINKS_FILE, {});
  const retaken = new Set(); // screens whose links were read again

  let cursor = 0;
  const worker = async (w) => {
    while (cursor < targets.length) {
      const s = targets[cursor++];
      const outAbs = path.join(SHOTS_DIR, `${s.id}.default.png`);
      const rel = path.relative(path.dirname(SHOTS_DIR), outAbs);
      const tmpAbs = path.join(SHOTS_DIR, `${s.id}.default.recap.png`);
      const res = await screenshot(base + s.url, tmpAbs, { virtualTime: 9000, profile: `re${w}`, warm: true, harvest: true });
      const capturedAt = new Date().toISOString();
      if (res.ok) {
        try {
          const prevDefault = Array.isArray(s.states) ? s.states.find((x) => x.state === "default" && x.ok && x.shot) : null;
          let history = Array.isArray(prevDefault?.history) ? prevDefault.history.slice() : [];
          try {
            if (fs.existsSync(outAbs)) {
              const beforeAt = prevDefault?.capturedAt || new Date(fs.statSync(outAbs).mtimeMs).toISOString();
              fs.mkdirSync(HISTORY_DIR, { recursive: true });
              const beforeAbs = path.join(HISTORY_DIR, `${s.id}.default.${beforeAt.replace(/[:.]/g, "-")}.png`);
              fs.copyFileSync(outAbs, beforeAbs);
              history = [{ shot: path.relative(OUT_DIR, beforeAbs), capturedAt: beforeAt, archivedAt: capturedAt }, ...history];
              for (const old of history.slice(HISTORY_KEEP)) {
                try { fs.rmSync(path.join(OUT_DIR, old.shot), { force: true }); } catch { /* already gone */ }
              }
              history = history.slice(0, HISTORY_KEEP);
            }
          } catch { /* archiving is best-effort */ }
          fs.renameSync(tmpAbs, outAbs);
          const others = Array.isArray(s.states) ? s.states.filter((x) => x.state !== "default") : [];
          s.states = [{ state: "default", ok: true, shot: rel, capturedAt, recaptured: true, history }, ...others];
          if (res.dom) {
            linksFromCapture(s, res);
            links[s.id] = { outLinks: s.outLinks, redirectTo: s.redirectTo, at: capturedAt };
            retaken.add(s.id);
          }
          results.push({ id: s.id, ok: true, capturedAt, route: s.route, history });
        } catch (e) {
          results.push({ id: s.id, ok: false, error: "swap-failed:" + e.code, route: s.route });
        }
      } else {
        try { fs.rmSync(tmpAbs, { force: true }); } catch { /* already gone */ }
        results.push({ id: s.id, ok: false, error: res.error, route: s.route });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, targets.length || 1) }, (_, w) => worker(w)));
  if (retaken.size) {
    writeJson(LINKS_FILE, links);
    regraphAfterRecapture(map, retaken);
  }
  writeJson(MAP_FILE, map);
  const captured = results.filter((r) => r.ok).length;
  log(`↻ recapture: ${captured}/${ids.length} refreshed (concurrency ${conc}).`);
  return { ok: true, requested: ids.length, captured, results };
}
