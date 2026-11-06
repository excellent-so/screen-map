// Screen Map: the CLI (npx @excellent-so/screen-map …). Docs: README.md.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { loadConfig, baseUrlProblem } from "./config.mjs";
import { initEnv, paths } from "./env.mjs";
import { resolveChrome, missingBrowserMessage } from "./chrome.mjs";
import { answers } from "./browser.mjs";
import { readJson, writeJson } from "./lib.mjs";
import { buildBugReport, bugIssueUrl } from "./bug-report.mjs";
import { scaffoldConfig } from "./scaffold.mjs";
import { UserError } from "./errors.mjs";
import { VERSION } from "./meta.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseFlags(argv) {
  const f = {}; const positionals = [];
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) f[m[1]] = m[2] === undefined ? true : m[2];
    else positionals.push(a);
  }
  return { f, positionals };
}

const COMMANDS = new Set(["build", "regraph", "capture-flow", "recapture", "serve", "open", "diff", "route", "init", "doctor", "bug"]);

/** A port number from a flag, or a UserError naming the flag. Absent → `dflt`. */
function portFlag(f, name, dflt) {
  if (f[name] === undefined) return dflt;
  const n = typeof f[name] === "string" && f[name].trim() ? Number(f[name]) : NaN;
  if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  throw new UserError(`--${name} needs a port number, like --${name}=4610.`);
}

/**
 * Check the dev server answers before a capture, so a build against a server that isn't running
 * stops with one sentence instead of mapping every screen as a failed shot. Any HTTP answer counts.
 */
async function requireServer(config) {
  const base = config.devBaseUrl;
  const problem = baseUrlProblem(base);
  if (problem) throw new UserError(problem);
  if (!(await answers(base + "/", 60000))) {
    throw new UserError(`Nothing answered at ${base}. Start your dev server (for example \`npm run dev\`), or pass its address with --base=<url>.`);
  }
}

/** Build config overrides from common CLI flags. */
function overridesFromFlags(f) {
  const o = {};
  if (f["app-dir"]) o.appDir = String(f["app-dir"]);
  if (f.base) o.devBaseUrl = String(f.base);
  if (f.framework) o.framework = String(f.framework);
  if (f.discovery) o.discovery = String(f.discovery).split(",").map((s) => s.trim()).filter(Boolean);
  if (f.chrome) o.chrome = String(f.chrome);
  if (f.output) o.output = { adapter: String(f.output) };
  if (typeof f["crawl-capture-max"] === "string") o.crawlCaptureMax = Number(f["crawl-capture-max"]);
  return o;
}

/**
 * Resolve config → (optionally) Chrome → install the runtime env. Returns { config }.
 */
async function setup(f, { needChrome = false, allowDownload = false } = {}) {
  const { config, root, file } = await loadConfig({ overrides: overridesFromFlags(f) });
  let chrome = { path: null, has: false, source: null };
  if (needChrome) {
    chrome = await resolveChrome({ explicit: config.chrome, allowDownload, log: (m) => console.error(m) });
    if (!chrome.has) { console.error("\n" + missingBrowserMessage() + "\n"); process.exit(1); }
  } else {
    // Best-effort detection so `doctor` and the map can report it, but don't require it.
    try { chrome = await resolveChrome({ explicit: config.chrome, allowDownload: false, log: () => {} }); } catch { /* ignore */ }
  }
  initEnv({ root, config, chrome });
  return { config, root, file, chrome };
}

/**
 * If a managed dev server is requested (config.server.autostart or --managed-server),
 * boot it, point capture at it by patching config.devBaseUrl (read lazily via
 * devBaseUrl()), and return the handle. Returns null when not requested.
 */
async function maybeStartManaged(config, root, f) {
  const wanted = f["managed-server"] || (config.server && config.server.autostart);
  if (!wanted) return null;
  if (!config.server || !config.server.command) {
    throw new UserError("--managed-server needs a `server` block in screen-map.config.* with at least a `command`, like server: { command: \"next dev\" }.");
  }
  const server = { ...config.server };
  if (f["server-port"]) server.port = portFlag(f, "server-port");
  if (f["no-watchdog"]) server.watchdog = false;
  const { startManagedServer } = await import("./server.mjs");
  const managed = await startManagedServer({ server, root, log: (m) => console.log(m) });
  config.devBaseUrl = managed.base; // env holds this same config ref → devBaseUrl() follows
  config.devBaseUrlFrom = "managed"; // gone after the run: never carried over to the next command
  return managed;
}

async function main() {
  const [cmd = "help", ...rest] = process.argv.slice(2);
  const { f } = parseFlags(rest);

  if (["help", "--help", "-h"].includes(cmd)) { printHelp(); return; }
  if (["version", "--version", "-v"].includes(cmd)) { console.log(VERSION); return; }
  if (!COMMANDS.has(cmd)) throw new UserError(`Unknown command "${cmd}". Run \`screen-map help\` for the list.`);
  // `screen-map build --help` asks for help; it must never start a build.
  if (f.help || rest.includes("-h")) { printHelp(); return; }

  switch (cmd) {
    case "build": {
      const needChrome = !f["no-capture"];
      const { config, root } = await setup(f, { needChrome, allowDownload: Boolean(f["download-chrome"]) });
      const managed = await maybeStartManaged(config, root, f);
      try {
        if (needChrome) await requireServer(config);
        const { runBuild } = await import("./build.mjs");
        await runBuild({
          force: Boolean(f.force),
          noCapture: Boolean(f["no-capture"]),
          noCrawl: Boolean(f["no-crawl"]),
          noStateSweep: Boolean(f["no-state-sweep"]),
          resolveDom: !f["no-resolve-dom"],
          states: f.states ? String(f.states).split(",") : undefined,
          limit: f.limit ? Number(f.limit) : 0,
          only: f.only ? String(f.only).split(",") : null,
          concurrency: f.concurrency ? Number(f.concurrency) : 2,
          crawlMax: f["crawl-max"] ? Number(f["crawl-max"]) : undefined,
          // A managed server can restart mid-run, so retry failed shots by default;
          // against a server you supply, opt in with --retry-failed.
          retryFailed: managed ? !f["no-retry"] : Boolean(f["retry-failed"]),
        });
      } finally {
        if (managed) { await managed.stop(); if (managed.restarts()) console.log(`  (managed server auto-restarted ${managed.restarts()}× during the run)`); }
      }
      break;
    }
    case "regraph": {
      await setup(f, { needChrome: false });
      const { runBuild } = await import("./build.mjs");
      await runBuild({ reuse: true });
      break;
    }
    case "capture-flow": {
      const { config, root } = await setup(f, { needChrome: true, allowDownload: Boolean(f["download-chrome"]) });
      const managed = await maybeStartManaged(config, root, f);
      try {
        await requireServer(config);
        const { captureFlow } = await import("./build.mjs");
        await captureFlow({ id: f.id ? String(f.id) : "onboarding", force: Boolean(f.force), concurrency: f.concurrency ? Number(f.concurrency) : 2 });
      } finally {
        if (managed) await managed.stop();
      }
      break;
    }
    case "recapture": {
      const ids = f.ids ? String(f.ids).split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (!ids.length) throw new UserError("recapture needs the screens to take again: --ids=id1,id2 (each screen's id is in .screenmap/screenmap.json, and in the viewer's copied command).");
      const { config } = await setup(f, { needChrome: true, allowDownload: Boolean(f["download-chrome"]) });
      if (!readJson(paths().MAP_FILE, null)) throw new UserError("No build yet. Run `screen-map build` first.");
      await requireServer(config);
      const { recaptureIds, shotError } = await import("./build.mjs");
      const r = await recaptureIds(ids, { concurrency: f.concurrency ? Number(f.concurrency) : 2, quiet: true });
      if (!r.ok) throw new UserError("No build yet. Run `screen-map build` first.");
      const notInMap = r.results.filter((x) => x.error === "unresolved").map((x) => x.id);
      if (notInMap.length) console.error(`Not screens of this map: ${notInMap.join(", ")}. Each screen's id is in .screenmap/screenmap.json.`);
      for (const x of r.results) if (!x.ok && x.error !== "unresolved") console.error(`  ${x.route || x.id}: ${shotError(x.error)}`);
      console.log(`↻ recaptured ${r.captured}/${r.requested}.${r.captured ? " Reload the viewer to see the refreshed screens." : ""}`);
      if (r.captured < r.requested) process.exitCode = 1;
      break;
    }
    case "serve":
    case "open": {
      await setup(f, { needChrome: false });
      const { serve } = await import("./serve.mjs");
      serve({ port: portFlag(f, "port", 4610), open: cmd === "open" });
      break;
    }
    case "diff": {
      await setup(f, { needChrome: false });
      const { MAP_FILE, BUILDS_DIR } = paths();
      const map = readJson(MAP_FILE, null);
      if (!map) throw new UserError("No build yet. Run `screen-map build` first.");
      console.log(`Latest build ${map.build.id}`);
      console.log(`  screens: ${map.build.routeCount} · resolved ${map.build.resolvedCount} · captured ${map.build.capturedCount}`);
      const list = (ids) => (ids.length ? `: ${ids.slice(0, 20).join(", ")}${ids.length > 20 ? "…" : ""}` : "");
      console.log(`  +${map.diff.added.length} new${list(map.diff.added)}`);
      console.log(`  −${map.diff.removed.length} removed${list(map.diff.removed)}`);
      if (!map.diff.hadPrevious) console.log("  (the first build: nothing to compare with yet)");
      if (map.crawlRan) console.log(`  proven orphans (walk ∖ crawl): ${(map.provenOrphans || []).length}`);
      break;
    }
    case "route": {
      await setup(f, { needChrome: false });
      const { sendFinding, adapterProblem, adapterNotReady, chosenAdapter } = await import("./output/index.mjs");
      const adapter = f.adapter ? String(f.adapter) : undefined;
      const name = chosenAdapter({ adapter });
      const problem = f["dry-run"] ? null : adapterProblem(name);
      if (problem) throw new UserError(problem);
      const { MAP_FILE, NOTES_FILE } = paths();
      const map = readJson(MAP_FILE, null);
      if (!map) throw new UserError("No build yet. Run `screen-map build` first.");
      const nf = readJson(NOTES_FILE, { notes: [] });
      let notes = nf.notes || [];
      // By default, only the notes still queued: one the viewer has handed to an agent, or approved,
      // isn't routed again (pass --all, or --note=<id>).
      if (f.note) notes = notes.filter((n) => n.id === String(f.note));
      else if (!f.all) notes = notes.filter((n) => (!n.status || n.status === "queued") && !n.routedTo);
      if (!notes.length) {
        console.log(f.note ? `No note with id ${f.note}.` : "No queued notes to route. Leave a note in the viewer and choose Queue for later, or pass --all to route every note.");
        if (f.note) process.exitCode = 1;
        break;
      }
      const notReady = f["dry-run"] ? null : adapterNotReady(name);
      if (notReady) throw new UserError(notReady);
      const { buildFinding, findingMarkdown } = await import("./finding.mjs");
      let sent = 0;
      for (const note of notes) {
        const finding = buildFinding(note, map);
        if (f["dry-run"]) { console.log(findingMarkdown(finding)); continue; }
        const out = await sendFinding(finding, adapter ? { adapter } : {});
        if (out.ok) { sent++; note.status = "sent"; note.routedTo = { adapter: name, ref: out.ref, url: out.url, at: new Date().toISOString() }; console.log(`✓ routed ${finding.id} → ${out.ref || "ok"}${out.url ? " " + out.url : ""}`); }
        else { console.error(`✗ ${finding.id}: ${out.message || out.error}`); }
      }
      if (f["dry-run"]) break;
      if (sent) { writeJson(NOTES_FILE, { ...nf, notes: nf.notes }); console.log(`\nRouted ${sent}/${notes.length} finding(s).`); }
      if (sent < notes.length) process.exitCode = 1;
      break;
    }
    case "init": {
      const { config } = await setup(f, { needChrome: false });
      const target = path.join(process.cwd(), "screen-map.config.mjs");
      if (fs.existsSync(target) && !f.force) throw new UserError(`${path.relative(process.cwd(), target)} already exists. Edit it, or pass --force to write a fresh one over it.`);
      fs.writeFileSync(target, scaffoldConfig(config));
      console.log(`✓ wrote ${path.relative(process.cwd(), target)}\n  Edit it, then run: screen-map build`);
      break;
    }
    case "doctor": {
      const { config, root, file, chrome } = await setup(f, { needChrome: false });
      const { listOutputAdapters, adapterProblem, adapterNotReady } = await import("./output/index.mjs");
      const { getDiscoveryAdapter } = await import("./discovery/index.mjs");
      const outName = config.output.adapter || "markdown";
      const outputProblem = adapterProblem(outName) || adapterNotReady(outName);
      const appDirFound = fs.existsSync(path.join(root, config.appDir));
      const baseProblem = baseUrlProblem(config.devBaseUrl);
      const serverUp = !baseProblem && await answers(config.devBaseUrl + "/", 5000);
      const knownFramework = Boolean(getDiscoveryAdapter(config.framework));
      const explicitMissing = config.chrome && !fs.existsSync(config.chrome);
      console.log("Screen Map — doctor\n");
      console.log(`  root:        ${root}`);
      console.log(`  config:      ${file || "(none — using zero-config defaults)"}`);
      console.log(`  appDir:      ${config.appDir}  ${appDirFound ? "✓" : "— not found: the map will be what the crawl reaches from /"}`);
      console.log(`  devBaseUrl:  ${config.devBaseUrl}${config.devBaseUrlFrom === "last build" ? " (the last build's)" : ""}  ${baseProblem ? `✗ ${baseProblem}` : serverUp ? "✓ answering" : config.server && config.server.command ? "— not answering (a managed server starts its own)" : "✗ nothing answering: start your dev server, or pass --base=<url>"}`);
      console.log(`  server:      ${config.server && config.server.command ? `managed (${Array.isArray(config.server.command) ? config.server.command.join(" ") : config.server.command})${config.server.autostart ? " · autostart" : " · via --managed-server"}` : "— (capture against devBaseUrl; add a `server` block to self-host one)"}`);
      console.log(`  framework:   ${config.framework}${knownFramework ? "" : `  ✗ unknown: take \`framework\` out of the config`}`);
      console.log(`  discovery:   ${config.discovery.join(" ∪ ")}`);
      console.log(`  chrome:      ${chrome.has ? `${chrome.path} (${chrome.source})${explicitMissing ? `  (no browser at ${config.chrome})` : ""}` : "✗ not found: install Google Chrome, or set SCREENMAP_CHROME to a Chrome-family browser"}`);
      console.log(`  output:      ${outName}  ${outputProblem ? `✗ ${outputProblem}` : `(available: ${listOutputAdapters().join(", ")})`}`);
      console.log(`  github:      ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? "✓ GITHUB_TOKEN set" : "— (set GITHUB_TOKEN to open issues)"}`);
      break;
    }
    case "bug": {
      await runBug(rest);
      break;
    }
    default:
      printHelp();
  }
}

/**
 * Ask questions one line at a time on stdin. Lines piped in all at once are kept for the
 * questions that follow, and a closed stdin answers "" rather than leaving the command hanging.
 */
function lineAsker() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = [], waiting = [];
  let closed = false;
  rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
  rl.on("close", () => { closed = true; for (const w of waiting.splice(0)) w(""); });
  return {
    ask(question) {
      process.stdout.write(question);
      if (lines.length) { const l = lines.shift(); if (!process.stdin.isTTY) process.stdout.write(l + "\n"); return Promise.resolve(l); }
      if (closed) { process.stdout.write("\n"); return Promise.resolve(""); }
      return new Promise((resolve) => waiting.push((l) => { if (!process.stdin.isTTY) process.stdout.write(l + "\n"); resolve(l); }));
    },
    close() { rl.close(); },
  };
}

/** Flags for `bug` only: unlike parseFlags() (which requires `--flag=value`), this
 *  also accepts a space-separated value (`--title smoke`) since title/description
 *  are naturally free text typed on the command line. */
function parseBugFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, inline] = m;
    if (inline !== undefined) { out[key] = inline; continue; }
    const next = argv[i + 1];
    if (key !== "yes" && next !== undefined && !/^--/.test(next)) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

/** `screen-map bug`: show the issue a bug report becomes, and print the link that files it on GitHub. */
async function runBug(argv) {
  const f = parseBugFlags(argv);
  const pkg = readJson(path.join(PKG_ROOT, "package.json"), {});
  const productVersion = pkg.version || "0.0.0";

  const severity = f.severity ? String(f.severity) : undefined;
  if (severity && !["low", "medium", "high"].includes(severity)) {
    throw new UserError(`Unknown --severity "${severity}". Use low, medium, or high.`);
  }

  let title = f.title ? String(f.title) : "";
  let description = f.description ? String(f.description) : "";
  if (!title || !description) {
    const asker = lineAsker();
    try {
      if (!title) title = (await asker.ask("Bug title: ")).trim();
      if (title && !description) description = (await asker.ask("Description (what happened, what you expected): ")).trim();
    } finally {
      asker.close();
    }
  }
  if (!title) throw new UserError("A bug report needs a title: type one at the prompt, or pass --title=<text>.");

  const report = buildBugReport({
    product: "screen-map",
    product_version: productVersion,
    title,
    description: description || undefined,
    severity,
    platform: { os: process.platform, arch: process.arch, runtime: `node ${process.version}` },
  });
  const issue = bugIssueUrl(report);

  console.log("\nNothing has been sent. This is the issue the link below fills in on GitHub:\n");
  console.log(`Title: ${issue.title}\n`);
  console.log(issue.body);
  console.log("");
  if (f.email) console.log("(--email is not used: GitHub shows who filed the issue, and issues are public.)\n");
  if (issue.trimmed) console.log("The description was cut to keep the link short. Paste the rest into the issue before you submit it.\n");
  console.log("Open this link, check the issue, and submit it:\n");
  console.log(issue.url);
}

function printHelp() {
  console.log(`screen-map — the map of your running app.

  screen-map build       enumerate → resolve → graph → capture → crawl ∪ walk → screenmap.json
      --force              recapture every screen (ignore the idempotent cache)
      --no-capture         graph/enumerate only (fast; no screenshots, no crawl)
      --no-crawl           skip the running-server crawl (router-walk only)
      --no-state-sweep     skip auto-discovering hidden state-machine screens
      --no-resolve-dom     skip the Chrome DOM harvest for dynamic-route ids
      --states=a,b         states to capture (default: default,loading)
      --limit=N            capture only the first N screens (quick check)
      --only=g1,g2         restrict capture to these groups
      --concurrency=N      parallel Chrome workers (default 2)
      --crawl-max=N        crawl page budget (default 200)
      --crawl-capture-max=N  screenshot at most N pages only the crawl found
                           (default 100, or crawlCaptureMax in the config; 0 for none)
      --managed-server     boot a PRIVATE, disposable dev server (needs a \`server\`
                           block in the config), capture against it, then tear it down
                           fully — no dependency on a server you keep running. Immune
                           to the mid-run wedge that fails long captures; turns on a
                           health watchdog (auto-restart) + a retry pass for failures.
      --server-port=N      (with --managed-server) pin the managed server's port
      --no-watchdog        (with --managed-server) don't auto-restart a wedged server
      --no-retry           (with --managed-server) skip the retry pass for failed shots
      --retry-failed       retry failed shots once (implied by --managed-server)
      --download-chrome    fetch Chrome on demand if none is found (needs @puppeteer/browsers)

  screen-map regraph     fast Chrome-free rebuild — reuse the last build's resolutions + shots
  screen-map capture-flow --id=<flow>   capture a declared flow's steps (dev preview)
  screen-map recapture --ids=a,b        refresh just these screens (the review-loop step)

  screen-map serve       host the web viewer (notes save to .screenmap/notes.json)
      --port=N            default 4610 (auto-advances if busy)
  screen-map open        serve + open the viewer in your browser

  screen-map route       turn review notes into tracked work via an output adapter
      --adapter=markdown|github   (default: config.output.adapter)
      --all               every note, not only the queued ones    --note=<id>  one note
      --dry-run           print the findings without sending

  screen-map diff        what changed since the last build
  screen-map init        scaffold a screen-map.config.mjs
  screen-map doctor      report config, Chrome, and output-adapter status

  screen-map bug          report a bug in screen-map itself: shows the issue, then prints
                          a link that opens it on GitHub, filled in (nothing is sent)
      --title=<text>        skip the title prompt
      --description=<text>  skip the description prompt
      --severity=low|medium|high

  Flags for any command:
      --base=<url>         your dev server (default http://localhost:3000, or SCREENMAP_BASE)
      --app-dir=<dir>      the App Router folder (default: app, else src/app)
      --chrome=<path>      the browser to screenshot with (or SCREENMAP_CHROME)
      --discovery=a,b      router-walk and/or crawl (default both)
      --framework=<name>   the discovery adapter (default next-app-router)
      --output=<adapter>   where findings go: markdown or github

  screen-map help         this help (also --help, -h, and after any command)
  screen-map --version    the installed version

  Zero-config on a standard Next.js App Router app. Other apps get the crawl only: the
  pages reachable by links from /, with screenshots, but no orphan report.
  Config: screen-map.config.{mjs,js,json}. Output lives in .screenmap/ (gitignore it).
  Requires your dev server running (or a \`server\` block and --managed-server).`);
}

main().catch((e) => {
  if (e instanceof UserError) console.error(e.message);
  else if (process.env.SCREENMAP_DEBUG) console.error(e);
  else console.error(`screen-map: ${(e && e.message) || e}\n(Run again with SCREENMAP_DEBUG=1 for the details. If it looks like a bug in Screen Map, \`screen-map bug\` reports it.)`);
  process.exit(1);
});
