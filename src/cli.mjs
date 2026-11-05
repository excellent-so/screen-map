// Screen Map: the CLI (npx @excellent-so/screen-map …). Docs: README.md.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { initEnv, paths } from "./env.mjs";
import { resolveChrome, missingBrowserMessage } from "./chrome.mjs";
import { readJson, writeJson } from "./lib.mjs";
import { buildBugReport, bugIssueUrl } from "./bug-report.mjs";
import { scaffoldConfig } from "./scaffold.mjs";

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

function resolvePort(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : 4610;
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
    try { chrome = await resolveChrome({ explicit: config.chrome, allowDownload: false }); } catch { /* ignore */ }
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
    console.error("--managed-server needs a `server` block in screen-map.config.* (at least `command`).");
    process.exit(1);
  }
  const server = { ...config.server };
  if (f["server-port"]) server.port = resolvePort(f["server-port"]);
  if (f["no-watchdog"]) server.watchdog = false;
  const { startManagedServer } = await import("./server.mjs");
  const managed = await startManagedServer({ server, root, log: (m) => console.log(m) });
  config.devBaseUrl = managed.base; // env holds this same config ref → devBaseUrl() follows
  return managed;
}

async function main() {
  const [cmd = "help", ...rest] = process.argv.slice(2);
  const { f, positionals } = parseFlags(rest);

  switch (cmd) {
    case "build": {
      const needChrome = !f["no-capture"];
      const { config, root } = await setup(f, { needChrome, allowDownload: Boolean(f["download-chrome"]) });
      const managed = await maybeStartManaged(config, root, f);
      try {
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
        const { captureFlow } = await import("./build.mjs");
        await captureFlow({ id: f.id ? String(f.id) : "onboarding", force: Boolean(f.force), concurrency: f.concurrency ? Number(f.concurrency) : 2 });
      } finally {
        if (managed) await managed.stop();
      }
      break;
    }
    case "recapture": {
      await setup(f, { needChrome: true, allowDownload: Boolean(f["download-chrome"]) });
      const { recaptureIds } = await import("./build.mjs");
      const ids = f.ids ? String(f.ids).split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (!ids.length) { console.error("recapture needs --ids=id1,id2 (screen ids from screenmap.json)"); process.exit(1); }
      const r = await recaptureIds(ids, { concurrency: f.concurrency ? Number(f.concurrency) : 2 });
      if (!r.ok) { console.error(`recapture failed: ${r.error}`); process.exit(1); }
      console.log(`↻ recaptured ${r.captured}/${r.requested}. Reload the viewer to see the refreshed screens.`);
      break;
    }
    case "serve":
    case "open": {
      await setup(f, { needChrome: false });
      const { serve } = await import("./serve.mjs");
      serve({ port: resolvePort(f.port), open: cmd === "open" });
      break;
    }
    case "diff": {
      await setup(f, { needChrome: false });
      const { MAP_FILE, BUILDS_DIR } = paths();
      const map = readJson(MAP_FILE, null);
      if (!map) { console.error("No build yet. Run `screen-map build`."); process.exit(1); }
      console.log(`Latest build ${map.build.id}`);
      console.log(`  screens: ${map.build.routeCount} · resolved ${map.build.resolvedCount} · captured ${map.build.capturedCount}`);
      console.log(`  +${map.diff.added.length} new: ${map.diff.added.slice(0, 20).join(", ")}${map.diff.added.length > 20 ? "…" : ""}`);
      console.log(`  −${map.diff.removed.length} removed: ${map.diff.removed.slice(0, 20).join(", ")}`);
      if (map.crawlRan) console.log(`  proven orphans (walk ∖ crawl): ${(map.provenOrphans || []).length}`);
      break;
    }
    case "route": {
      await setup(f, { needChrome: false });
      const { sendFinding, adapterProblem, chosenAdapter } = await import("./output/index.mjs");
      const adapter = f.adapter ? String(f.adapter) : undefined;
      const problem = f["dry-run"] ? null : adapterProblem(chosenAdapter({ adapter }));
      if (problem) { console.error(problem); process.exit(1); }
      const { MAP_FILE, NOTES_FILE } = paths();
      const map = readJson(MAP_FILE, null);
      if (!map) { console.error("No build yet. Run `screen-map build`."); process.exit(1); }
      const nf = readJson(NOTES_FILE, { notes: [] });
      let notes = nf.notes || [];
      if (f.note) notes = notes.filter((n) => n.id === String(f.note));
      else if (!f.all) notes = notes.filter((n) => n.status !== "sent");
      if (!notes.length) { console.log("No notes to route (use --all to include already-sent notes, or leave a note in the viewer first)."); break; }
      const { buildFinding } = await import("./finding.mjs");
      let sent = 0;
      for (const note of notes) {
        const finding = buildFinding(note, map);
        if (f["dry-run"]) { const { findingMarkdown } = await import("./finding.mjs"); console.log(findingMarkdown(finding)); continue; }
        const out = await sendFinding(finding, adapter ? { adapter } : {});
        if (out.ok) { sent++; note.status = "sent"; note.routedTo = { adapter: adapter || (map.build && "configured"), ref: out.ref, url: out.url, at: new Date().toISOString() }; console.log(`✓ routed ${finding.id} → ${out.ref || "ok"}${out.url ? " " + out.url : ""}`); }
        else { console.error(`✗ ${finding.id}: ${out.error}${out.message ? " — " + out.message : ""}`); }
      }
      if (!f["dry-run"] && sent) { writeJson(NOTES_FILE, { ...nf, notes: nf.notes }); console.log(`\nRouted ${sent}/${notes.length} finding(s).`); }
      break;
    }
    case "init": {
      const { config } = await setup(f, { needChrome: false });
      const target = path.join(process.cwd(), "screen-map.config.mjs");
      if (fs.existsSync(target) && !f.force) { console.error(`${target} already exists (pass --force to overwrite).`); process.exit(1); }
      fs.writeFileSync(target, scaffoldConfig(config));
      console.log(`✓ wrote ${path.relative(process.cwd(), target)}\n  Edit it, then run: screen-map build`);
      break;
    }
    case "doctor": {
      const { config, root, file, chrome } = await setup(f, { needChrome: false });
      const { listOutputAdapters, adapterProblem } = await import("./output/index.mjs");
      const outputProblem = adapterProblem(config.output.adapter || "markdown");
      console.log("Screen Map — doctor\n");
      console.log(`  root:        ${root}`);
      console.log(`  config:      ${file || "(none — using zero-config defaults)"}`);
      console.log(`  appDir:      ${config.appDir}  ${fs.existsSync(path.join(root, config.appDir)) ? "✓" : "✗ (not found)"}`);
      console.log(`  devBaseUrl:  ${config.devBaseUrl}`);
      console.log(`  server:      ${config.server && config.server.command ? `managed (${Array.isArray(config.server.command) ? config.server.command.join(" ") : config.server.command})${config.server.autostart ? " · autostart" : " · via --managed-server"}` : "— (capture against devBaseUrl; add a `server` block to self-host one)"}`);
      console.log(`  framework:   ${config.framework}`);
      console.log(`  discovery:   ${config.discovery.join(" ∪ ")}`);
      console.log(`  chrome:      ${chrome.has ? `${chrome.path} (${chrome.source})` : "✗ not found — run `build --download-chrome` or set SCREENMAP_CHROME"}`);
      console.log(`  output:      ${config.output.adapter || "markdown"}  ${outputProblem ? `✗ ${outputProblem}` : `(available: ${listOutputAdapters().join(", ")})`}`);
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

/** Ask a single line on stdin. */
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
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
    console.error(`Unknown --severity "${severity}". Use low, medium, or high.`);
    process.exit(1);
  }

  let title = f.title ? String(f.title) : "";
  let description = f.description ? String(f.description) : "";
  if (!title || !description) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!title) title = (await ask(rl, "Bug title: ")).trim();
      if (!description) description = (await ask(rl, "Description (what happened, what you expected): ")).trim();
    } finally {
      rl.close();
    }
  }
  if (!title) { console.error("A title is required."); process.exit(1); }

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
      --managed-server     boot a PRIVATE, disposable dev server (needs a \`server\`
                           block in the config), capture against it, then tear it down
                           fully — no dependency on a server you keep running. Immune
                           to the mid-run wedge that fails long captures; turns on a
                           health watchdog (auto-restart) + a retry pass for failures.
      --server-port=N      (with --managed-server) pin the managed server's port
      --no-watchdog        (with --managed-server) don't auto-restart a wedged server
      --no-retry           (with --managed-server) skip the retry pass for failed shots
      --retry-failed       retry failed shots once (implied by --managed-server)
      --download-chrome    fetch Chrome on demand if none is found (never a hidden postinstall)

  screen-map regraph     fast Chrome-free rebuild — reuse the last build's resolutions + shots
  screen-map capture-flow --id=<flow>   capture a declared flow's steps (dev preview)
  screen-map recapture --ids=a,b        refresh just these screens (the review-loop step)

  screen-map serve       host the web viewer (notes save to .screenmap/notes.json)
      --port=N            default 4610 (auto-advances if busy)
  screen-map open        serve + open the viewer in your browser

  screen-map route       turn review notes into tracked work via an output adapter
      --adapter=markdown|github   (default: config.output.adapter)
      --all               include already-sent notes    --note=<id>  a single note
      --dry-run           print the findings without sending

  screen-map diff        what changed since the last build
  screen-map init        scaffold a screen-map.config.mjs
  screen-map doctor      report config, Chrome, and output-adapter status

  screen-map bug          report a bug in screen-map itself: shows the issue, then prints
                          a link that opens it on GitHub, filled in (nothing is sent)
      --title=<text>        skip the title prompt
      --description=<text>  skip the description prompt
      --severity=low|medium|high

  Zero-config on a standard Next.js App Router app. Other apps get the crawl only: the
  pages reachable by links from /, without screenshots or the orphan report.
  Config: screen-map.config.{mjs,js,json}. Output lives in .screenmap/ (gitignore it).
  Requires your dev server running (or a \`server\` block and --managed-server).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
