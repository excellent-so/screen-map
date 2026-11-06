// The review loop: recapturing a screen reads its links again (so its Orphan and Dead end badges
// follow the page), build and regraph keep the before/after history a recapture built up, and the
// served viewer loads without a failed request when there are no prototypes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { loadConfig } from "../src/config.mjs";
import { initEnv } from "../src/env.mjs";
import { serve } from "../src/serve.mjs";
import { ok, eq, includes, excludes, writeFakeChrome, runCli, serveRoutes, htmlPage, shotOf } from "./helpers.mjs";

const byId = (map, id) => (map?.screens || []).find((s) => s.id === id);
const hasEdge = (map, from, to) => (map?.edges || []).some((e) => e.from === from && e.to === to);

export async function run() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "screen-map-review-")));
  try {
    // ── The served viewer: no prototypes file is an empty list, not a 404 ──────────────
    const root = path.join(tmp, "served");
    fs.mkdirSync(path.join(root, ".screenmap"), { recursive: true });
    fs.writeFileSync(path.join(root, ".screenmap", "screenmap.json"), JSON.stringify({ screens: [], edges: [], orphans: [], deadEnds: [] }));
    const { config } = await loadConfig({ cwd: root });
    initEnv({ root, config, chrome: { path: null, has: false, source: null } });
    const quiet = console.log; console.log = () => {};
    let server;
    try { server = serve({ port: 0 }); await once(server, "listening"); } finally { console.log = quiet; }
    try {
      const base = `http://localhost:${server.address().port}`;
      const none = await fetch(base + "/prototypes.json");
      eq(none.status, 200, "with no prototypes file, the viewer's prototypes.json request succeeds");
      eq(await none.json(), { prototypes: [] }, "and answers an empty list");
      fs.writeFileSync(path.join(root, ".screenmap", "prototypes.json"), JSON.stringify({ prototypes: [{ id: "p1" }] }));
      eq((await (await fetch(base + "/prototypes.json")).json()).prototypes.map((p) => p.id), ["p1"], "a prototypes file that exists is served as written");
      eq((await fetch(base + "/missing.json")).status, 404, "other missing files still 404");
    } finally {
      await new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); });
    }

    // ── Recapture reads links again; history survives build and regraph ────────────────
    if (process.platform === "win32") { console.log("  (review loop end-to-end: skipped on Windows)"); return; }
    const chrome = writeFakeChrome(tmp);
    const project = path.join(tmp, "app-project");
    for (const r of ["", "a", "b", "c"]) {
      fs.mkdirSync(path.join(project, "app", r), { recursive: true });
      fs.writeFileSync(path.join(project, "app", r, "page.tsx"), `export default function P() { return <main>${r || "home"}</main>; }\n`);
    }
    // The running app. /c exists but nothing links to it; /a links nowhere.
    const links = { "/": ["/a", "/b"], "/a": [], "/b": ["/"], "/c": ["/"] };
    const page = (p) => htmlPage(() => links[p].map((to) => `<a href="${to}">${to}</a>`).join(" "));
    const site = await serveRoutes(Object.fromEntries(Object.keys(links).map((p) => [p, page(p)])));
    const flags = [`--base=${site.base}`, `--chrome=${chrome}`];
    try {
      const b1 = await runCli(project, ["build", ...flags]);
      eq(b1.code, 0, "review loop: the first build exits 0");
      includes(b1.map?.orphans, "c", "review loop: /c starts as an orphan");
      includes(b1.map?.deadEnds, "a", "review loop: /a starts as a dead end");

      // The agent's fix: /a now links to /c. Recapture /a and /b.
      links["/a"] = ["/c"];
      const r = await runCli(project, ["recapture", "--ids=a,b", `--chrome=${chrome}`, `--base=${site.base}`]);
      eq(r.code, 0, "recapture exits 0");
      ok(hasEdge(r.map, "a", "c"), "recapture reads the page's links again (a → c)");
      excludes(r.map?.orphans, "c", "recapture: /c, now linked, is no longer an orphan");
      excludes(r.map?.deadEnds, "a", "recapture: /a, now linking out, is no longer a dead end");
      const links1 = JSON.parse(fs.readFileSync(path.join(project, ".screenmap", "links.json"), "utf8"));
      eq(links1.a?.outLinks, ["/c"], "recapture saves the page's new links for the next regraph");
      const histA = shotOf(byId(r.map, "a"))?.history || [];
      const histB = shotOf(byId(r.map, "b"))?.history || [];
      ok(histA.length === 1 && histB.length === 1, "recapture archives the shot it replaced (one before, one after)");
      ok(histA.every((h) => fs.existsSync(path.join(project, ".screenmap", h.shot))), "the archived shot is on disk");
      const recapturedAt = shotOf(byId(r.map, "b"))?.capturedAt;

      // A build after the review: /a's page changed again (so it's taken fresh), /b's didn't (reused).
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(project, "app", "a", "page.tsx"), future, future);
      const b2 = await runCli(project, ["build", ...flags]);
      eq(b2.code, 0, "review loop: the build after the review exits 0");
      eq(shotOf(byId(b2.map, "a"))?.history, histA, "build keeps the history of a screen it took again");
      eq(shotOf(byId(b2.map, "b"))?.history, histB, "build keeps the history of a screen whose shot it reused");
      eq(shotOf(byId(b2.map, "b"))?.capturedAt, recapturedAt, "a reused shot keeps the time it was taken");
      excludes(b2.map?.orphans, "c", "build: /c stays linked");

      const rg = await runCli(project, ["regraph"]);
      eq(rg.code, 0, "regraph exits 0");
      eq(shotOf(byId(rg.map, "a"))?.history, histA, "regraph keeps the before/after history");
      eq(shotOf(byId(rg.map, "b"))?.history, histB, "regraph keeps it on every screen");
      ok(hasEdge(rg.map, "a", "c") && !(rg.map?.deadEnds || []).includes("a"), "regraph keeps the links the recapture read");
    } finally {
      await site.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
