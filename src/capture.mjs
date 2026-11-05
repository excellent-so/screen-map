// Screen Map — capture: screenshot each resolved screen × state.
//
// States:
//   default — the running app as-is (always).
//   loading — screenshot at a tiny virtual-time budget so the Suspense skeleton is
//             what paints (approximate; only for routes with a loading file).
//   empty/error — DECLARED but not auto-captured in the MVP: forcing them needs a
//             disposable-DB dev server (empty) or per-route bad instances (error).
//             Recorded as capture:false so the viewer shows the gap.

import fs from "node:fs";
import path from "node:path";
import { env, devBaseUrl, paths } from "./env.mjs";
import { extractHrefs, normalizePath, readJson, writeJson } from "./lib.mjs";
import { screenshot, hasChrome } from "./browser.mjs";

async function pool(items, n, fn) {
  const q = items.map((it, i) => [it, i]);
  let cursor = 0;
  const workers = Math.max(1, Math.min(n, q.length || 1));
  const worker = async (w) => {
    while (cursor < q.length) {
      const idx = cursor++;
      try { await fn(q[idx][0], w, q[idx][1]); } catch { /* recorded as a failed shot below */ }
    }
  };
  await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
}

const isCold = (s) => Boolean(s.coldOnly || s.flow?.coldOnly);

function pageAbsFor(s) {
  return s.file ? path.join(env().root, s.file) : null;
}

/** The default-state shot if one is on disk AND fresh (mtime >= its page file). */
function freshShotFor(s) {
  const { SHOTS_DIR } = paths();
  const outAbs = path.join(SHOTS_DIR, `${s.id}.default.png`);
  const pageAbs = pageAbsFor(s);
  try {
    const shotM = fs.statSync(outAbs).mtimeMs;
    const pageM = pageAbs && fs.existsSync(pageAbs) ? fs.statSync(pageAbs).mtimeMs : 0;
    if (shotM >= pageM) {
      return { state: "default", ok: true, shot: path.relative(path.dirname(SHOTS_DIR), outAbs), cached: true };
    }
  } catch { /* no shot / no page file */ }
  return null;
}

function coldStates(s) {
  const fresh = s.flow?.entry ? null : freshShotFor(s);
  if (fresh) return [{ ...fresh, cold: true }];
  const reason = s.flow?.entry
    ? "redirect hub → flow — captured via `capture-flow` (dev preview)"
    : "cold-start only — run `screen-map capture-flow`";
  return [{ state: "default", capture: false, cold: true, reason }];
}

function statesFor(screen, wanted) {
  const out = [];
  for (const st of wanted) {
    if (st === "default") out.push({ state: "default", capture: true, vt: 9000 });
    else if (st === "loading") {
      if (screen.capabilities.hasLoading) out.push({ state: "loading", capture: true, vt: 450, approx: true });
    } else if (st === "empty") {
      out.push({ state: "empty", capture: false, reason: screen.capabilities.hasColdStart ? "needs disposable-DB server" : "no cold-start component" });
    } else if (st === "error") {
      out.push({ state: "error", capture: false, reason: "needs per-route bad instance" });
    }
  }
  return out;
}

export async function captureAll(screens, opts = {}) {
  const {
    states = ["default", "loading"], force = false, limit = 0,
    concurrency = 2, log = () => {}, only = null, flowOnly = null,
    retryFailed = false,
  } = opts;
  const { SHOTS_DIR, LINKS_FILE } = paths();
  const base = devBaseUrl();
  // Clamp: NaN/0/negative would spawn zero workers; too high OOM-wedges the dev server.
  const conc = Math.max(1, Math.min(8, Number.isFinite(concurrency) ? Math.floor(concurrency) : 2));

  if (!hasChrome()) {
    log("capture: no Chrome found — skipping captures (nodes still render, greyed).");
    for (const s of screens) s.states = [];
    return { captured: 0, skipped: 0, failed: 0 };
  }

  let targets = screens.filter((s) => s.resolved && s.url);
  if (flowOnly) {
    targets = targets.filter((s) => s.flow?.id === flowOnly && s.flow?.step);
  } else {
    if (only && only.length) targets = targets.filter((s) => only.includes(s.group));
    targets = targets.filter((s) => !isCold(s));
  }
  if (limit > 0) targets = targets.slice(0, limit);
  const targetSet = new Set(targets);

  const tasks = [];
  for (const s of screens) {
    if (isCold(s) && !targetSet.has(s)) { s.states = coldStates(s); continue; }
    s.states = statesFor(s, states);
    if (!targetSet.has(s)) {
      const fresh = freshShotFor(s);
      if (fresh) s.states = [fresh, ...s.states.filter((x) => x.state !== "default")];
      continue;
    }
    for (const st of s.states) if (st.capture) tasks.push({ s, st });
  }
  log(`capture: ${tasks.length} shots across ${targets.length} screens (concurrency ${conc})…`);

  const linksCache = readJson(LINKS_FILE, {});
  let captured = 0, skipped = 0, failed = 0, done = 0;
  await pool(tasks, conc, async ({ s, st }, w) => {
    const outAbs = path.join(SHOTS_DIR, `${s.id}.${st.state}.png`);
    const rel = path.relative(path.dirname(SHOTS_DIR), outAbs);
    const pageAbs = pageAbsFor(s);
    const doHarvest = st.state === "default";
    // Idempotent: skip if a fresh shot exists and the page file is older.
    if (!force && fs.existsSync(outAbs)) {
      try {
        const pageM = pageAbs && fs.existsSync(pageAbs) ? fs.statSync(pageAbs).mtimeMs : 0;
        if (fs.statSync(outAbs).mtimeMs >= pageM) {
          st.shot = rel; st.ok = true; st.cached = true; skipped++; done++;
          if (doHarvest && linksCache[s.id]) { s.outLinks = linksCache[s.id].outLinks || []; s.redirectTo = linksCache[s.id].redirectTo || null; }
          return;
        }
      } catch { /* fall through to capture */ }
    }
    const res = await screenshot(base + s.url, outAbs, { virtualTime: st.vt, profile: `cap${w}`, warm: true, harvest: doHarvest });
    st.capturedAt = new Date().toISOString();
    if (res.ok) { st.shot = rel; st.ok = true; st.bytes = res.bytes; captured++; }
    else { st.ok = false; st.error = res.error; failed++; }
    if (doHarvest && res.dom) {
      const finalPath = normalizePath(res.finalUrl), reqPath = normalizePath(s.url);
      if (finalPath && finalPath !== reqPath) { s.redirectTo = finalPath; s.outLinks = []; }
      else { s.outLinks = extractHrefs(res.dom); s.redirectTo = null; }
      linksCache[s.id] = { outLinks: s.outLinks, redirectTo: s.redirectTo, at: st.capturedAt };
    }
    done++;
    if (done % 15 === 0) {
      log(`capture: ${done}/${tasks.length} (${captured} new, ${skipped} cached, ${failed} failed)`);
      writeJson(LINKS_FILE, linksCache);
    }
  });

  // Retry pass: a shot that failed while the server was briefly wedged (or was
  // mid-restart under a managed server) usually succeeds on a second try. Re-run
  // just the failed (screen,state) tasks once — cheap relative to a whole rebuild,
  // and the biggest single lever on completeness after a transient server hiccup.
  if (retryFailed && failed > 0) {
    const failedTasks = tasks.filter(({ st }) => st.ok === false);
    log(`capture: retrying ${failedTasks.length} failed shot(s)…`);
    let recovered = 0;
    await pool(failedTasks, conc, async ({ s, st }, w) => {
      const outAbs = path.join(SHOTS_DIR, `${s.id}.${st.state}.png`);
      const rel = path.relative(path.dirname(SHOTS_DIR), outAbs);
      const doHarvest = st.state === "default";
      const res = await screenshot(base + s.url, outAbs, { virtualTime: st.vt, profile: `rty${w}`, warm: true, harvest: doHarvest });
      st.capturedAt = new Date().toISOString();
      if (res.ok) {
        st.shot = rel; st.ok = true; st.bytes = res.bytes; delete st.error;
        captured++; failed--; recovered++;
        if (doHarvest && res.dom) {
          const finalPath = normalizePath(res.finalUrl), reqPath = normalizePath(s.url);
          if (finalPath && finalPath !== reqPath) { s.redirectTo = finalPath; s.outLinks = []; }
          else { s.outLinks = extractHrefs(res.dom); s.redirectTo = null; }
          linksCache[s.id] = { outLinks: s.outLinks, redirectTo: s.redirectTo, at: st.capturedAt };
        }
      } else {
        st.error = res.error;
      }
    });
    log(`capture: retry recovered ${recovered}/${failedTasks.length}.`);
  }

  writeJson(LINKS_FILE, linksCache);
  log(`capture: done — ${captured} new, ${skipped} cached, ${failed} failed.`);
  return { captured, skipped, failed };
}
