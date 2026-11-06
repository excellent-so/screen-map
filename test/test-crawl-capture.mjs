// Crawl capture: the pages only the crawl finds get screenshots, taken the same way as the
// walk's routes, grouped by path, and never reported as orphans.
//
// The end-to-end half runs the real `screen-map build` against local sites, with a stand-in
// for Chrome (a small Node script that answers --screenshot and --dump-dom over plain HTTP),
// so it needs no browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enumerate } from "../src/discovery/next-app-router.mjs";
import { unionCrawl } from "../src/discovery/index.mjs";
import { notAPage } from "../src/discovery/crawl.mjs";
import { buildGraph } from "../src/graph.mjs";
import { loadConfig } from "../src/config.mjs";
import { startFixtureSite } from "../scripts/fixture-site.mjs";
import {
  setupFixture, FIXTURE_DIR, ok, eq, includes, excludes,
  PNG, writeFakeChrome, runCli as cli, serveRoutes, htmlPage, shotOf,
} from "./helpers.mjs";

const byRoute = (map, route) => (map?.screens || []).find((s) => s.route === route);

/** True if the screen's default shot is on disk, is a PNG, and was taken of `url`. */
function shotIsOf(project, s, url) {
  const st = shotOf(s);
  if (!st) return false;
  try {
    const buf = fs.readFileSync(path.join(project, ".screenmap", st.shot));
    return buf.subarray(0, 8).toString("hex") === PNG && buf.toString("latin1").includes(`screenshot of ${url}\n`);
  } catch { return false; }
}

export async function run() {
  // ── What gets a screenshot: HTML pages of the app, nothing else ─────────────────
  const base = "http://localhost:3000";
  eq(notAPage({ ok: true, status: 200, finalUrl: base + "/x", contentType: "text/html; charset=utf-8" }, base), null, "an HTML page of the app gets a screenshot");
  eq(notAPage({ ok: true, status: 200, finalUrl: base + "/x", contentType: "application/xhtml+xml" }, base), null, "an XHTML page gets a screenshot");
  eq(notAPage({ ok: true, status: 200, finalUrl: base + "/x", contentType: "" }, base), null, "a page with no content type gets a screenshot");
  eq(notAPage({ ok: true, status: 200, finalUrl: base + "/site.css", contentType: "text/css" }, base), "Not a page (text/css)", "a stylesheet is not a page");
  eq(notAPage({ ok: true, status: 200, finalUrl: base + "/feed.xml", contentType: "application/rss+xml" }, base), "Not a page (application/rss+xml)", "a feed is not a page");
  eq(notAPage({ ok: true, status: 404, finalUrl: base + "/gone", contentType: "text/html" }, base), "Not a page (answered 404)", "a link that answers 404 is not a page");
  eq(notAPage({ ok: true, status: 200, finalUrl: "https://example.com/", contentType: "text/html" }, base), "Not a page (redirects to example.com)", "a redirect to another site is not a page");
  eq(notAPage({ ok: false, status: 0, error: "ECONNREFUSED" }, base), null, "a failed fetch says nothing (the capture may try)");

  // ── The union: crawl-only nodes, grouped by path, never orphans ────────────────
  await setupFixture();
  const walk = enumerate();
  const reached = new Set(["/", "/settings", "/help", "/help/faq", "/site.css"]);
  const u = unionCrawl(walk, {
    ran: true, reachedPaths: reached,
    notPages: new Map([["/site.css", "Not a page (text/css)"]]),
    edges: [{ fromPath: "/", toPath: "/settings" }, { fromPath: "/settings", toPath: "/help" }, { fromPath: "/help", toPath: "/help/faq" }, { fromPath: "/", toPath: "/site.css" }],
  });
  eq(u.crawlOnly, ["/help", "/help/faq", "/site.css"], "crawl-only paths are the reached paths no walk route covers");
  const help = u.screens.find((s) => s.route === "/help");
  const faq = u.screens.find((s) => s.route === "/help/faq");
  const css = u.screens.find((s) => s.route === "/site.css");
  ok(help && help.crawlOnly && help.page === true && help.resolved && help.url === "/help", "a crawl-only page is a resolved node marked as a page");
  eq(help.states, [], "a crawl-only page starts with no states (the build's capture fills them)");
  eq([help.group, faq.group], ["help", "help"], "crawl-only pages are grouped by path, like the walk's routes");
  ok(css && css.page === false, "a crawl-only stylesheet is marked not a page");
  eq(css.states, [{ state: "default", capture: false, reason: "Not a page (text/css)" }], "a non-page carries the reason it has no screenshot");
  for (const id of [help.id, faq.id, css.id]) excludes(u.provenOrphans, id, `crawl-only ${id} is never a proven orphan`);
  includes(u.provenOrphans, "orphan-page", "a walk route the crawl never reached is still a proven orphan");
  ok(unionCrawl(walk, { ran: true, reachedPaths: new Set(["/", "/help"]), edges: [] }).screens.find((s) => s.route === "/help").page === true,
    "a crawl result without notPages treats every crawl-only path as a page");

  // Even with no edge into them, a screen the crawl reached is not an orphan.
  const g = buildGraph(u.screens, { crawlEdges: [] });
  for (const id of [help.id, faq.id, css.id, "settings"]) excludes(g.orphans, id, `${id}, reached by the crawl, is not an orphan without an edge in`);
  includes(g.orphans, "orphan-page", "orphan-page, never reached, is still an orphan");

  // ── The cap's config option ─────────────────────────────────────────────────────
  const capOf = async (v) => (await loadConfig({ cwd: FIXTURE_DIR, overrides: v === undefined ? {} : { crawlCaptureMax: v } })).config.crawlCaptureMax;
  eq(await capOf(undefined), 100, "crawlCaptureMax defaults to 100");
  eq(await capOf(0), 0, "crawlCaptureMax 0 takes no crawl screenshots");
  eq(await capOf(false), 0, "crawlCaptureMax false is 0");
  eq(await capOf("12"), 12, "crawlCaptureMax takes a numeric string (the CLI flag)");
  eq(await capOf(-3), 100, "a negative crawlCaptureMax falls back to the default");

  // ── End to end, with the stand-in browser ───────────────────────────────────────
  if (process.platform === "win32") { console.log("  (crawl capture end-to-end: skipped on Windows)"); return; }
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "screen-map-crawlcap-")));
  const chrome = writeFakeChrome(tmp);
  const project = (name, { app = false, config = null } = {}) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    if (app) {
      fs.cpSync(path.join(FIXTURE_DIR, "app"), path.join(dir, "app"), { recursive: true });
      fs.cpSync(path.join(FIXTURE_DIR, "pages"), path.join(dir, "pages"), { recursive: true });
    }
    if (config) fs.writeFileSync(path.join(dir, "screen-map.config.json"), JSON.stringify(config));
    return dir;
  };
  const site = await startFixtureSite();
  const flags = [`--base=${site.base}`, `--chrome=${chrome}`, "--concurrency=4"];
  try {
    // A non-Next app: no app/ folder, so the map is the crawl alone, and every page it reaches gets a shot.
    const plain = project("plain");
    const a = await cli(plain, ["build", ...flags]);
    eq(a.code, 0, "non-Next app: build exits 0");
    const crawled = ["/", "/dashboard", "/settings", "/reports", "/help", "/about", "/reports/q1", "/reports/q2", "/reports/q3"];
    eq((a.map?.screens || []).map((s) => s.route).sort(), crawled.slice().sort(), "non-Next app: the map holds exactly the pages the crawl reached");
    ok(a.map && a.map.screens.every((s) => s.crawlOnly), "non-Next app: every screen is crawl-found");
    ok(a.map && a.map.build.capturedCount === crawled.length && a.map.build.routeCount === crawled.length, `non-Next app: every crawled page has a screenshot (${a.map?.build.capturedCount} of ${a.map?.build.routeCount})`);
    for (const r of crawled) ok(shotIsOf(plain, byRoute(a.map, r), site.base + r), `non-Next app: ${r} has a PNG taken of its own URL`);
    eq(byRoute(a.map, "/reports/q2")?.group, "reports", "non-Next app: /reports/q2 is grouped under reports");
    ok(a.map && a.map.groups.includes("root") && a.map.groups.includes("reports"), "non-Next app: the board's columns are the path groups");
    eq(a.map?.orphans, [], "non-Next app: no crawled page is an orphan");
    eq(a.map?.provenOrphans, [], "non-Next app: no proven orphans without a walk");
    ok(a.map && a.map.edges.some((e) => e.from === "settings" && e.to === "help"), "non-Next app: the links between crawled pages are graphed");
    ok(a.log.includes("capture: pages only the crawl found"), "non-Next app: the build log names the crawl capture step");
    ok((byRoute(a.map, "/settings")?.states || []).length === 1, "non-Next app: a crawled page gets the default state only (no loading file to show)");

    // Built again: crawl-found pages have no source file to date them, so they're taken fresh.
    const firstAt = shotOf(byRoute(a.map, "/help"))?.capturedAt;
    const a2 = await cli(plain, ["build", ...flags]);
    const again = shotOf(byRoute(a2.map, "/help"));
    ok(again && !again.cached && again.capturedAt && firstAt && again.capturedAt > firstAt, "a rebuild takes crawl-found pages again rather than reusing the old shot");

    // regraph keeps the crawl-found screens and their shots.
    const rg = await cli(plain, ["regraph"]);
    eq(rg.code, 0, "regraph exits 0");
    eq((rg.map?.screens || []).length, crawled.length, "regraph keeps every crawl-found screen");
    ok(rg.map && rg.map.screens.every((s) => shotOf(s)), "regraph keeps their screenshots");
    eq(rg.map?.orphans, [], "regraph: no crawled page becomes an orphan");

    // The cap: the pages nearest / first, and the log says how to raise it.
    const capped = project("capped");
    const c = await cli(capped, ["build", ...flags, "--crawl-capture-max=3"]);
    eq(c.code, 0, "capped: build exits 0");
    eq((c.map?.screens || []).filter((s) => shotOf(s)).map((s) => s.route), ["/", "/dashboard", "/settings"], "--crawl-capture-max=3 shoots the three pages nearest /");
    eq(c.map?.screens.length, crawled.length, "capped: pages past the cap stay on the map");
    ok(/6 more crawl-found page\(s\) have no screenshot: crawlCaptureMax is 3/.test(c.log), "capped: the log says how many pages the cap left out");
    const off = project("off", { config: { crawlCaptureMax: 0 } });
    const o = await cli(off, ["build", ...flags]);
    ok(o.code === 0 && o.map && o.map.build.capturedCount === 0 && o.map.screens.length === crawled.length, "crawlCaptureMax: 0 in the config maps the crawl with no screenshots");
    ok(o.log.includes("crawlCaptureMax is 0"), "crawlCaptureMax: 0 says so in the log");
    const lim = project("limited");
    const l = await cli(lim, ["build", ...flags, "--limit=2"]);
    eq(l.map?.build.capturedCount, 2, "--limit caps the crawl capture too");

    // A Next app: the walk's routes as before, plus /help (a Pages Router page) only the crawl finds.
    const next = project("next", { app: true });
    const n = await cli(next, ["build", ...flags]);
    eq(n.code, 0, "Next app: build exits 0");
    const nh = byRoute(n.map, "/help");
    ok(nh && nh.crawlOnly && !nh.file, "Next app: /help is a crawl-found screen");
    ok(shotIsOf(next, nh, site.base + "/help"), "Next app: the crawl-only /help has a screenshot of its own URL");
    eq(nh?.group, "help", "Next app: /help is in its own path group");
    ok(n.map && n.map.build.capturedCount === n.map.build.routeCount, `Next app: every screen has a screenshot (${n.map?.build.capturedCount} of ${n.map?.build.routeCount})`);
    excludes(n.map?.orphans, nh?.id, "Next app: /help is not an orphan");
    excludes(n.map?.provenOrphans, nh?.id, "Next app: /help is not a proven orphan");
    includes(n.map?.provenOrphans, "orphan-page", "Next app: /orphan-page is still a proven orphan");
    includes(n.map?.orphans, "orphan-page", "Next app: /orphan-page is still an orphan");
    ok(n.map && n.map.edges.some((e) => e.from === "settings" && e.to === nh?.id), "Next app: the settings → help link is graphed");
    ok(shotIsOf(next, byRoute(n.map, "/dashboard"), site.base + "/dashboard"), "Next app: walk routes are still captured");
  } finally {
    await site.close();
  }

  // URLs the crawl reaches that aren't pages get no screenshot, and say why.
  const elsewhere = await serveRoutes({ "/": htmlPage("<h1>Another site</h1>") });
  const small = await serveRoutes({
    "/": htmlPage('<link rel="stylesheet" href="/theme.css"><link rel="preload" as="image" href="/logo.svg"><a href="/site.css">Styles</a> <a href="/pricing">Pricing</a> <a href="/gone">Gone</a> <a href="/out">Out</a>'),
    "/pricing": htmlPage('<h1>Pricing</h1><a href="/">Home</a>'),
    "/site.css": (_req, res) => { res.writeHead(200, { "content-type": "text/css" }); res.end("body { color: black }"); },
    "/theme.css": (_req, res) => { res.writeHead(200, { "content-type": "text/css" }); res.end("body { color: black }"); },
    "/out": (_req, res) => { res.writeHead(302, { location: elsewhere.base + "/" }); res.end(); },
  });
  try {
    const dir = project("small");
    const s = await cli(dir, ["build", `--base=${small.base}`, `--chrome=${chrome}`]);
    eq(s.code, 0, "small site: build exits 0");
    ok(shotIsOf(dir, byRoute(s.map, "/pricing"), small.base + "/pricing"), "small site: /pricing has a screenshot");
    eq(s.map?.build.capturedCount, 2, "small site: only the two HTML pages are captured");
    const expect = [["/site.css", "Not a page (text/css)"], ["/gone", "Not a page (answered 404)"], ["/out", `Not a page (redirects to ${new URL(elsewhere.base).host})`]];
    for (const [route, reason] of expect) {
      const scr = byRoute(s.map, route);
      ok(scr && scr.page === false && !shotOf(scr), `small site: ${route} is on the map with no screenshot`);
      eq((scr?.states || [])[0]?.reason, reason, `small site: ${route} says why`);
      ok(!fs.existsSync(path.join(dir, ".screenmap", "shots", `${scr?.id}.default.png`)), `small site: no shot file was written for ${route}`);
      excludes(s.map?.deadEnds, scr?.id, `small site: ${route}, not a page, is not a dead end`);
    }
    for (const asset of ["/theme.css", "/logo.svg"]) ok(!byRoute(s.map, asset), `small site: a <link> in the head (${asset}) is not a link to a screen`);
  } finally {
    await small.close();
    await elsewhere.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
