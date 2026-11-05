// The independence gate: Screen Map does its job with nothing else installed.
//
// It copies the committed fixture app into a fresh temp project, serves a static mirror of it
// (scripts/fixture-site.mjs) on a free localhost port, and runs `screen-map build` there with:
//   - HOME set to a fresh, empty temp dir
//   - PATH cut to node's own bin dir plus /usr/bin:/bin
//   - no inherited environment variable: only HOME, PATH, TMPDIR and LANG, all set below
//   - the working directory outside any git repo
// The build must exit 0 and write the map: .screenmap/screenmap.json with screenshots on disk,
// the viewer beside it, and the orphan page proven. Chrome is whatever the tool finds on the system.
// Everything it starts is stopped, and the temp dir is removed (pass --keep to look at it).
//
//   npm run test:standalone

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureSite } from "./fixture-site.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "screen-map.mjs");
const KEEP = process.argv.includes("--keep");
const TIMEOUT_MS = 5 * 60 * 1000;

let failures = 0;
function check(cond, msg) {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}

/** True if `dir` or any parent holds a .git entry. */
function insideRepo(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return true;
    if (path.dirname(d) === d) return false;
  }
}

/** Kill any process whose command line mentions `marker` (a leftover Chrome under our temp dir). */
function killLeftovers(marker) {
  if (process.platform === "win32") return 0;
  let pids = [];
  try {
    pids = execFileSync("pgrep", ["-f", marker], { stdio: ["ignore", "pipe", "ignore"] }).toString().split(/\s+/).filter(Boolean).map(Number);
  } catch { return 0; } // pgrep exits 1 when nothing matches
  for (const pid of pids) if (pid !== process.pid) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  return pids.length;
}

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "screen-map-standalone-")));
const home = path.join(tmp, "home");
const tmpdir = path.join(tmp, "tmp");
const project = path.join(tmp, "project");
fs.mkdirSync(home); fs.mkdirSync(tmpdir); fs.mkdirSync(project);
fs.cpSync(path.join(ROOT, "fixture", "app"), path.join(project, "app"), { recursive: true });

const env = {
  HOME: home,
  PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
  TMPDIR: tmpdir,
  LANG: "C",
};

let site = null, child = null, code = null;
const t0 = Date.now();
try {
  console.log("screen-map standalone: build a map with nothing else installed\n");
  check(!insideRepo(project), `working directory is outside any git repo (${project})`);
  check(Object.keys(env).sort().join(",") === "HOME,LANG,PATH,TMPDIR", "no inherited variable: only HOME, PATH, TMPDIR and LANG are set");
  check(fs.readdirSync(home).length === 0, "HOME is a fresh, empty dir");

  site = await startFixtureSite();
  console.log(`  ..    fixture site on ${site.base}\n`);

  child = spawn(process.execPath, [BIN, "build", `--base=${site.base}`, "--concurrency=4"], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const timer = setTimeout(() => { log += "\n(timed out)\n"; child.kill("SIGKILL"); }, TIMEOUT_MS);
  code = await new Promise((resolve) => child.on("close", (c) => resolve(c)));
  clearTimeout(timer);
  child = null;
  for (const line of log.trim().split("\n")) console.log(`        ${line}`);
  console.log("");

  check(code === 0, `screen-map build exited 0 (got ${code})`);
  const out = path.join(project, ".screenmap");
  let map = null;
  try { map = JSON.parse(fs.readFileSync(path.join(out, "screenmap.json"), "utf8")); } catch { /* checked below */ }
  check(Boolean(map), "wrote .screenmap/screenmap.json");
  if (map) {
    const shots = map.screens.flatMap((s) => (s.states || []).filter((st) => st.ok && st.shot).map((st) => path.join(out, st.shot)));
    const pngs = shots.filter((f) => { try { return fs.readFileSync(f).subarray(0, 4).toString("hex") === "89504e47"; } catch { return false; } });
    check(map.screens.length >= 10, `mapped every fixture route (${map.screens.length} screens)`);
    check(map.build.capturedCount > 0 && map.build.capturedCount === map.build.routeCount, `screenshot every screen (${map.build.capturedCount} of ${map.build.routeCount})`);
    check(shots.length > 0 && pngs.length === shots.length, `every screenshot is a PNG on disk (${pngs.length})`);
    check(map.edges.length > 0, `graphed the links (${map.edges.length} edges)`);
    check(map.crawlRan === true, "crawled the running site");
    check((map.provenOrphans || []).includes("orphan-page"), "proved /orphan-page is an orphan");
    check((map.deadEnds || []).includes("about"), "found /about is a dead end");
  }
  check(fs.existsSync(path.join(out, "index.html")), "wrote the viewer beside the map");
} catch (e) {
  console.error(e);
  failures++;
} finally {
  if (child) child.kill("SIGKILL");
  if (site) await site.close();
  const killed = killLeftovers(tmp);
  check(killed === 0, "no browser left running");
  if (KEEP) console.log(`\n  kept ${tmp}`);
  else fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nscreen-map standalone: ${failures ? `${failures} failed` : "passed"} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
