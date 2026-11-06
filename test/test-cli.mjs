// The CLI as a stranger meets it: help never runs a command, mistakes get one sentence and a
// failing exit code (no stack trace), a dev server that isn't running stops a build before it
// starts, and a plain static site with relative links maps every page. Runs the real CLI against
// local sites with a stand-in for Chrome, so it needs no browser.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startFixtureSite } from "../scripts/fixture-site.mjs";
import { VERSION } from "../src/meta.mjs";
import { FIXTURE_DIR, ok, eq, excludes, writeFakeChrome, runCli as cli, serveRoutes, htmlPage, shotOf, PNG } from "./helpers.mjs";

const STACK = /\n\s+at .+\(.+:\d+:\d+\)/;
const byRoute = (map, route) => (map?.screens || []).find((s) => s.route === route);

/** A port nothing listens on. */
function closedPort() {
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

export async function run() {
  if (process.platform === "win32") { console.log("  (cli end-to-end: skipped on Windows)"); return; }
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "screen-map-cli-")));
  const chrome = writeFakeChrome(tmp);
  const dir = (name, { app = false } = {}) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d);
    if (app) fs.cpSync(path.join(FIXTURE_DIR, "app"), path.join(d, "app"), { recursive: true });
    return d;
  };
  const site = await startFixtureSite();
  try {
    // ── Help, version and unknown commands ──────────────────────────────────────
    const h = dir("help", { app: true });
    const bh = await cli(h, ["build", "--help", `--base=${site.base}`, `--chrome=${chrome}`]);
    ok(bh.code === 0 && bh.log.includes("screen-map build") && !fs.existsSync(path.join(h, ".screenmap")), "`build --help` prints the help and builds nothing");
    const rh = await cli(h, ["recapture", "-h"]);
    ok(rh.code === 0 && rh.log.includes("screen-map recapture"), "`recapture -h` prints the help");
    const v = await cli(h, ["--version"]);
    eq(v.log.trim(), VERSION, "--version prints the version");
    const u = await cli(h, ["buidl"]);
    ok(u.code === 1 && u.log.trim() === 'Unknown command "buidl". Run `screen-map help` for the list.', "an unknown command exits 1 with one line");

    // ── Config mistakes: one line naming the file, no stack trace ───────────────
    const bad = dir("bad-config");
    fs.writeFileSync(path.join(bad, "screen-map.config.mjs"), 'export default { appDir: "app", ');
    const bc = await cli(bad, ["doctor"]);
    ok(bc.code === 1 && /^Couldn't load screen-map\.config\.mjs: .+ Fix it, or delete it to use the defaults\.$/.test(bc.log.trim()), `a config with a syntax error gets one line (got: ${bc.log.trim().slice(0, 120)})`);
    fs.rmSync(path.join(bad, "screen-map.config.mjs"));
    fs.writeFileSync(path.join(bad, "screen-map.config.json"), '{ "appDir": "app", }');
    const bj = await cli(bad, ["build", "--no-capture"]);
    ok(bj.code === 1 && bj.log.trim().startsWith("Couldn't load screen-map.config.json:") && !STACK.test(bj.log), "a JSON config that doesn't parse gets one line");
    fs.writeFileSync(path.join(bad, "screen-map.config.json"), '{ "framework": "remix" }');
    const fw = await cli(bad, ["build", "--no-capture"]);
    ok(fw.code === 1 && fw.log.includes('Unknown framework "remix"') && !STACK.test(fw.log), "an unknown framework gets one line, no stack trace");
    const fd = await cli(bad, ["doctor"]);
    ok(fd.code === 0 && /framework:\s+remix\s+✗ unknown/.test(fd.log), "doctor flags an unknown framework");

    // ── The dev server: checked before a build, and the address forgiven its form ───────
    const port = await closedPort();
    const down = dir("down", { app: true });
    const d = await cli(down, ["build", `--base=http://127.0.0.1:${port}`, `--chrome=${chrome}`]);
    ok(d.code === 1 && d.log.trim() === `Nothing answered at http://127.0.0.1:${port}. Start your dev server (for example \`npm run dev\`), or pass its address with --base=<url>.`, "a build against a server that isn't running exits 1 with one sentence");
    ok(!fs.existsSync(path.join(down, ".screenmap", "screenmap.json")), "…and writes no map of failed shots and false orphans");
    const ftp = await cli(down, ["build", "--base=ftp://example.com", `--chrome=${chrome}`]);
    ok(ftp.code === 1 && ftp.log.includes("isn't a web address"), "a base that isn't http(s) is refused in one line");
    const dd = await cli(down, ["doctor", `--base=http://127.0.0.1:${port}`]);
    ok(/devBaseUrl:\s+http:\/\/127\.0\.0\.1:\d+\s+✗ nothing answering/.test(dd.log), "doctor says when nothing answers at the dev server's address");
    const bare = dir("bare-base", { app: true });
    const bb = await cli(bare, ["build", `--base=${site.base.replace(/^http:\/\//, "")}/`, `--chrome=${chrome}`, "--no-crawl", "--limit=1"]);
    ok(bb.code === 0 && bb.map && bb.map.build.devBaseUrl === site.base && bb.map.build.capturedCount === 1, "--base without http:// or with a trailing slash still works");

    // ── Commands that need a build, before there is one ─────────────────────────
    const fresh = dir("fresh");
    const rg = await cli(fresh, ["regraph"]);
    ok(rg.code === 1 && rg.log.trim() === "No build to regraph yet. Run `screen-map build` first." && !fs.existsSync(path.join(fresh, ".screenmap", "screenmap.json")), "regraph with no build exits 1 and writes no empty map");
    const rc = await cli(fresh, ["recapture", "--ids=home", `--chrome=${chrome}`]);
    ok(rc.code === 1 && rc.log.trim() === "No build yet. Run `screen-map build` first.", "recapture with no build says to build first");
    const rn = await cli(fresh, ["recapture"]);
    ok(rn.code === 1 && rn.log.includes("--ids=id1,id2"), "recapture with no ids says how to name them");
    const sp = await cli(fresh, ["serve", "--port=abc"]);
    ok(sp.code === 1 && sp.log.trim() === "--port needs a port number, like --port=4610.", "serve --port=abc is refused in one line");

    // ── A browser that runs but writes nothing: say so, and claim no orphans ────────
    const dud = path.join(tmp, "dud-chrome.mjs");
    fs.writeFileSync(dud, `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o755 });
    const nd = dir("dud", { app: true });
    const n = await cli(nd, ["build", `--base=${site.base}`, `--chrome=${dud}`]);
    ok(n.code === 1 && n.log.includes(`✗ No screenshot worked (Chrome wrote no screenshot). Check that ${dud} opens`), "a browser that writes no screenshots fails the build with what to do");
    eq(n.map?.provenOrphans, [], "a crawl that loaded no page proves no orphans");
    ok(n.log.includes("crawl: no page loaded"), "…and the log says the crawl loaded nothing");

    // ── bug: answers piped in, or none at all ──────────────────────────────────────
    const piped = await cli(fresh, ["bug"], { input: "The board is blank\nNo columns show.\n" });
    ok(piped.code === 0 && piped.log.includes("Title: The board is blank") && piped.log.includes("No columns show.") && piped.log.includes("/issues/new?title=The%20board%20is%20blank"), "bug reads a title and description piped in");
    const none = await cli(fresh, ["bug"], { input: "" });
    ok(none.code === 1 && none.log.trim().endsWith("A bug report needs a title: type one at the prompt, or pass --title=<text>."), "bug with nothing on stdin exits 1 and says what it needs");

    // ── route: the queued notes only, and an adapter that isn't ready stops it once ──
    const rt = dir("route", { app: true });
    const built = await cli(rt, ["build", `--base=${site.base}`, `--chrome=${chrome}`, "--no-crawl"]);
    eq(built.code, 0, "route: the build exits 0");
    // The address given to the build carries over: no --base needed to refresh a screen after it.
    const rcap = await cli(rt, ["recapture", "--ids=dashboard", `--chrome=${chrome}`]);
    ok(rcap.code === 0 && rcap.log.includes("recaptured 1/1"), `recapture after \`build --base=…\` loads the same address without being told (${rcap.log.trim().split("\n").pop()})`);
    const rdoc = await cli(rt, ["doctor"]);
    ok(rdoc.log.includes(`devBaseUrl:  ${site.base} (the last build's)  ✓ answering`), "doctor shows the address carried over from the last build");
    const notes = [
      { id: "n1", screens: ["dashboard"], body: "Queued note", status: "queued", direction: "issue", intent: "fix" },
      { id: "n2", screens: ["dashboard"], body: "With the agent", status: "sent", direction: "issue", intent: "fix" },
      { id: "n3", screens: ["settings"], body: "Already approved", status: "approved", direction: "issue", intent: "fix" },
    ];
    fs.writeFileSync(path.join(rt, ".screenmap", "notes.json"), JSON.stringify({ notes, stale: [] }));
    const dry = await cli(rt, ["route", "--dry-run"]);
    ok(dry.code === 0 && dry.log.includes("Queued note") && !dry.log.includes("Already approved") && !dry.log.includes("With the agent"), "route takes only the queued notes, not ones with an agent or approved");
    const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GH_TOKEN;
    const gh = await cli(rt, ["route", "--adapter=github"], { env });
    ok(gh.code === 1 && gh.log.trim().split("\n").length === 1 && gh.log.includes("GITHUB_TOKEN"), "route --adapter=github with no token exits 1 with one line, not one per note");
    const ghr = await cli(rt, ["route", "--adapter=github"], { env: { ...env, GITHUB_TOKEN: "test-token-not-real" } });
    ok(ghr.code === 1 && ghr.log.includes("can't tell which GitHub repo"), "route --adapter=github outside a GitHub clone says which repo setting it needs");
    const md = await cli(rt, ["route"]);
    const after = JSON.parse(fs.readFileSync(path.join(rt, ".screenmap", "notes.json"), "utf8")).notes;
    ok(md.code === 0 && md.log.includes("Routed 1/1"), "route sends the one queued note to markdown");
    eq(after.map((x) => x.status), ["sent", "sent", "approved"], "an approved note stays approved");
    const again = await cli(rt, ["route"]);
    ok(again.code === 0 && again.log.includes("No queued notes to route"), "a routed note isn't routed again");

    // ── open, with its port busy: the next free port, announced and opened once ────────
    const busy = [];
    let first = 0;
    for (let tries = 0; tries < 20 && busy.length < 2; tries++) {
      const p0 = first || await closedPort();
      const s0 = http.createServer(() => {});
      const okListen = await new Promise((resolve) => { s0.once("error", () => resolve(false)); s0.listen(p0 + busy.length, () => resolve(true)); });
      if (okListen) { busy.push(s0); first = p0; } else { for (const b of busy.splice(0)) b.close(); first = 0; }
    }
    const stubs = path.join(tmp, "stub-bin");
    fs.mkdirSync(stubs, { recursive: true });
    const opened = path.join(tmp, "opened.log");
    for (const name of ["open", "xdg-open"]) fs.writeFileSync(path.join(stubs, name), `#!/bin/sh\necho "$@" >> "${opened}"\n`, { mode: 0o755 });
    const { spawn } = await import("node:child_process");
    const viewer = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "..", "bin", "screen-map.mjs"), "open", `--port=${first}`],
      { cwd: rt, env: { ...process.env, PATH: `${stubs}${path.delimiter}${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    viewer.stdout.on("data", (c) => { out += c; });
    for (let i = 0; i < 50 && !out.includes("Screen Map →"); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 600));
    viewer.kill("SIGTERM");
    for (const b of busy) b.close();
    const announced = out.match(/Screen Map → \S+/g) || [];
    eq(announced, [`Screen Map → http://localhost:${first + 2}`], "open past two busy ports announces the next free one, once");
    eq(fs.existsSync(opened) ? fs.readFileSync(opened, "utf8").trim().split("\n") : [], [`http://localhost:${first + 2}`], "…and opens the browser once");
  } finally {
    await site.close();
  }

  // ── A plain static site, served like `npx serve`: relative links, clean URLs, folders ──
  const page = (title, links) => htmlPage(`<h1>${title}</h1>${links}`);
  const moved = (to) => (_req, res) => { res.writeHead(301, { location: to }); res.end(); };
  const blog = page("Blog", '<a href="first.html">First</a> <a href="../">Home</a>');
  const plainSite = await serveRoutes({
    "/": (req, res) => page("Home", `<link rel="stylesheet" href="style.css"><a href="about.html">About</a> <a href="blog/">Blog</a> <a href="http://${req.headers.host}/contact">Contact</a> <a href="https://example.com/">Elsewhere</a> <a href="#top">Top</a> <a href="mailto:a@b.c">Mail</a>`)(req, res),
    "/index.html": moved("/"),
    "/about.html": moved("/about"),
    "/about": page("About", '<a href="index.html">Home</a> <a href="./team.html">Team</a>'),
    "/team.html": moved("/team"),
    "/team": page("Team", '<a href="../about.html">About</a>'),
    "/blog/": blog,
    "/blog": blog, // a folder answers without its slash too, where its relative links would break
    "/blog/first.html": moved("/blog/first"),
    "/blog/first": page("First", '<a href="./">Blog</a>'),
    "/contact": page("Contact", ""),
  });
  try {
    const st = dir("static");
    const s = await cli(st, ["build", `--base=${plainSite.base}`, `--chrome=${chrome}`]);
    eq(s.code, 0, "static site: build exits 0");
    const pages = ["/", "/about", "/blog", "/blog/first", "/contact", "/team"];
    eq((s.map?.screens || []).map((x) => x.route).sort(), pages, "static site: every page reached by a relative or absolute link is mapped, once, under its clean URL");
    for (const r of pages) {
      const scr = byRoute(s.map, r);
      const want = plainSite.base + (r === "/blog" ? "/blog/" : r);
      let shotOk = false;
      try { const buf = fs.readFileSync(path.join(st, ".screenmap", shotOf(scr).shot)); shotOk = buf.subarray(0, 8).toString("hex") === PNG && buf.toString("latin1").includes(`screenshot of ${want}\n`); } catch { /* no shot */ }
      ok(shotOk, `static site: ${r} has a screenshot of ${want}`);
    }
    const has = (a, b) => (s.map?.edges || []).some((e) => e.from === a && e.to === b);
    ok(has("home", "about") && has("home", "blog") && has("home", "contact") && has("about", "team") && has("team", "about") && has("blog", "blog__first") && has("blog__first", "blog"), "static site: relative links, links that redirect and absolute same-site links are graphed");
    excludes((s.map?.screens || []).map((x) => x.route), "/first.html", "static site: a folder's relative links resolve against the folder");
    eq(s.map?.deadEnds, ["contact"], "static site: only the page with no links out is a dead end");
  } finally {
    await plainSite.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
