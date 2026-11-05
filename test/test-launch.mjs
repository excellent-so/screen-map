// Launch hygiene: the bug report, the links the tool writes, no local paths or
// internal text in what ships, and the viewer keeping the kit's look rules.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildBugReport, validateBugReport, bugIssue, bugIssueUrl, URL_MAX } from "../src/bug-report.mjs";
import { HOMEPAGE, VERSION, NAME, BUGS_URL } from "../src/meta.mjs";
import { scaffoldConfig } from "../src/scaffold.mjs";
import { issueBody } from "../src/output/github.mjs";
import { baseArgs } from "../src/browser.mjs";
import { paths } from "../src/env.mjs";
import { synced, block, BLOCKS } from "../scripts/sync-styleguide.mjs";
import { startFixtureSite } from "../scripts/fixture-site.mjs";
import { ok, eq, setupFixture } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PKG = JSON.parse(read("package.json"));

/** Every file under the given dirs (and the given files), relative to the repo root. */
function shipped(entries) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) { for (const e of fs.readdirSync(abs)) walk(path.join(rel, e)); }
    else out.push(rel);
  };
  for (const e of entries) walk(e);
  return out;
}

/** Run the viewer's first-paint theme script against a fake page; returns whether it chose dark. */
function bootTheme(html, { search = "", stored = {} } = {}) {
  const src = html.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/)[1];
  const classes = new Set();
  const ctx = {
    URLSearchParams,
    location: { search },
    localStorage: { getItem: (k) => (k in stored ? stored[k] : null) },
    document: { documentElement: { classList: { add: (c) => classes.add(c) } } },
  };
  vm.runInNewContext(src, ctx);
  return classes.has("theme-dark");
}

export async function run() {
  // The bug report (screen-map bug): a prefilled GitHub new-issue link, nothing sent.
  const r = buildBugReport({ product: "screen-map", title: "  " + "x".repeat(300) + "  ", description: "d" });
  eq(r.schema, "bug-report.v1", "bug report carries its schema");
  eq(r.title.length, 200, "bug report title is clamped to 200 characters");
  ok(typeof r.created_at === "string" && !Number.isNaN(Date.parse(r.created_at)), "bug report is stamped with created_at");
  ok(validateBugReport(r).ok, "a well-formed bug report validates");
  eq(validateBugReport({ ...r, severity: "urgent" }).error, "bad-severity", "an unknown severity is rejected");
  eq(validateBugReport({ ...r, title: "" }).error, "bad-title", "an empty title is rejected");
  ok(!("contact_email" in buildBugReport({ product: "screen-map", title: "t", contact_email: "a@b.co" })), "a bug report never carries an email address into a public issue");
  eq(buildBugReport({ product: "screen-map", title: "🙂".repeat(150) }).title.length, 200, "the title clamp never splits a character in two");

  eq(BUGS_URL, PKG.bugs.url, "meta BUGS_URL is package.json's bugs.url");
  const rep = buildBugReport({
    product: "screen-map", product_version: "1.2.3", title: "Board is blank", description: "Columns have no names.", severity: "high",
    platform: { os: "linux", arch: "x64", runtime: "node v22.0.0" }, created_at: "2026-01-02T03:04:05.000Z",
  });
  const issue = bugIssue(rep);
  eq(issue.title, "Board is blank", "the issue title is the report's title");
  ok(issue.body.startsWith("Columns have no names."), "the issue body starts with the description");
  for (const bit of ["Severity: high", "screen-map 1.2.3", "node v22.0.0", "linux x64", "2026-01-02T03:04:05.000Z"]) {
    ok(issue.body.includes(bit), `the issue body includes ${bit}`);
  }
  const link = bugIssueUrl(rep);
  ok(link.url.startsWith(`${PKG.bugs.url}/new?title=`), "the link opens a new issue on the repo in package.json's bugs.url");
  const u = new URL(link.url);
  eq(u.searchParams.get("title"), issue.title, "the link fills in exactly the title shown");
  eq(u.searchParams.get("body"), issue.body, "the link fills in exactly the body shown");
  ok(!link.trimmed, "a short report is not trimmed");
  eq(bugIssueUrl(rep, { bugsUrl: "https://github.com/a/b/issues/" }).url.split("?")[0], "https://github.com/a/b/issues/new", "a trailing slash on bugs.url is handled");

  const long = buildBugReport({ ...rep, description: "näïve 🙂 words, ".repeat(700) });
  const longLink = bugIssueUrl(long);
  ok(longLink.trimmed, "a long report is trimmed");
  ok(longLink.url.length <= URL_MAX && URL_MAX <= 7000, `a trimmed link stays within ${URL_MAX} characters (got ${longLink.url.length})`);
  ok(longLink.url.length > URL_MAX - 200, "trimming keeps as much of the description as fits");
  eq(new URL(longLink.url).searchParams.get("body"), longLink.body, "a trimmed link fills in exactly the trimmed body shown");
  ok(longLink.body.includes("screen-map 1.2.3") && longLink.body.includes("(Trimmed to fit the link.)"), "trimming keeps the versions and says it trimmed");

  const bugSrc = read("src/bug-report.mjs") + read("src/cli.mjs");
  ok(!/\bfetch\(|https?:\/\/(?!github\.com)[^\s"'`]*excellent|EXCELLENT_/.test(bugSrc), "screen-map bug makes no network request and reads no EXCELLENT_* variable");

  // screen-map bug, end to end: it prints the issue and the link, and exits 0.
  const bugRun = spawnSync(process.execPath, [path.join(ROOT, "bin", "screen-map.mjs"), "bug", "--title=Smoke", "--description=It broke."], { encoding: "utf8", timeout: 20000 });
  eq(bugRun.status, 0, "screen-map bug exits 0");
  ok(bugRun.stdout.includes("Nothing has been sent") && bugRun.stdout.includes("It broke."), "screen-map bug shows the issue it fills in");
  ok(bugRun.stdout.includes(`${PKG.bugs.url}/new?title=Smoke&body=`), "screen-map bug prints the prefilled new-issue link");

  // The links the tool writes point at the package's own home.
  eq(HOMEPAGE, PKG.homepage, "meta HOMEPAGE is package.json's homepage");
  eq(VERSION, PKG.version, "meta VERSION is package.json's version");
  eq(NAME, PKG.name, "meta NAME is package.json's name");
  const scaffold = scaffoldConfig({ appDir: "app", devBaseUrl: "http://localhost:3000" });
  ok(scaffold.includes(PKG.homepage), "the init scaffold links to the package's homepage");
  ok(!scaffold.includes("excellentso/"), "the init scaffold has no link to the old excellentso account");
  const mod = await import("data:text/javascript," + encodeURIComponent(scaffold));
  eq(mod.default.appDir, "app", "the init scaffold is a loadable config module");
  const body = issueBody({ id: "f_1", routes: ["/x"], urls: [], shots: [], signals: {}, direction: "issue", intent: "fix", body: "b" });
  ok(body.includes(`(${PKG.homepage})`), "an opened GitHub issue credits the package's homepage");

  // Headless Chrome never asks the OS for stored secrets (a fresh HOME would hang on a keychain prompt).
  await setupFixture();
  const args = baseArgs("cap0");
  ok(args.includes("--headless=new"), "Chrome runs headless (new mode)");
  ok(args.includes("--use-mock-keychain"), "Chrome uses a mock keychain, so a fresh HOME can't stall it on a prompt");
  ok(args.includes("--password-store=basic"), "Chrome uses the basic password store, never the OS keyring");
  ok(args.includes(`--user-data-dir=${path.join(paths().OUT_DIR, ".chrome", "cap0")}`), "each Chrome profile is isolated under .screenmap/.chrome");

  // Nothing that ships names a local path or internal code.
  const files = shipped(["bin", "src", "viewer", "scripts", "README.md", "CHANGELOG.md", "package.json", "fixture"]);
  const LOCAL = /\/Users\/|~\/Sites|mattwaite/;
  const localHits = files.filter((f) => LOCAL.test(read(f)));
  eq(localHits, [], "no shipped file names a local home path");
  const INTERNAL = /excellent\/app|@excellent\/(ui|core)|styleguide\/lab|pnpm screenmap|ModeRail|modes-registry|_chrome\/|PRD §|Locked #|internal tool|excellent-mcp|EXCELLENT_BUG/;
  const internalHits = files.filter((f) => INTERNAL.test(read(f)));
  eq(internalHits, [], "no shipped file names internal paths, packages or commands");

  // The editor extension runs the scoped package, never an unscoped `screen-map` someone else could publish.
  const extFiles = ["extension/src/extension.js", "extension/README.md", "extension/package.json"];
  eq(extFiles.filter((f) => /npx (--yes )?screen-map\b/.test(read(f))), [], "the extension only ever runs npx @excellent-so/screen-map");

  // The viewer keeps the kit's look rules.
  const viewer = read("viewer/index.html");
  const kit = block(viewer, BLOCKS[0]);
  ok(kit && kit.includes("@excellent-so/kit"), "the viewer carries the kit block, written by excellent-kit sync");
  ok(kit && kit.includes(".theme-dark") && kit.includes("--color-verified"), "the kit block has the kit's tokens and dark theme");
  // The favicon follows the OS theme (the browser's tab strip does); nothing else in the viewer may.
  ok(!/prefers-color-scheme/.test(viewer.replace(/<link rel="icon"[^>]*>/, "")), "the viewer never keys a style on prefers-color-scheme");

  // Screen Map's own mark, and nothing of Excellent's, in the header and the tab.
  const MARK = '<svg class="ex-mark" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="6" height="5"/><rect x="9" y="10" width="6" height="5"/><path d="M4 6v7h5" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
  const guideHtml = read("viewer/styleguide.html");
  for (const [name, html] of [["viewer", viewer], ["styleguide", guideHtml]]) {
    const brand = (html.match(/<span class="brand">([\s\S]*?)<\/span>/) || [])[1] || "";
    ok(brand.includes(MARK) && /Screen Map\s*$/.test(brand), `the ${name}'s brand row is Screen Map's mark, then its name`);
    const icon = (html.match(/<link rel="icon" href="([^"]*)"/) || [])[1] || "";
    ok(icon.startsWith("data:image/svg+xml,") && /<path d=['"]M4 6v7h5['"]/.test(decodeURIComponent(icon)), `the ${name}'s favicon is Screen Map's mark`);
    ok(!/xmark|by Excellent|class="by"|excellent\.so/.test(html), `the ${name} has no Excellent brandmark, byline or link`);
  }
  ok(read("docs/mark.svg").includes('<path d="M4 6v7h5"'), "docs/mark.svg is Screen Map's mark");
  ok(read("README.md").startsWith('<img src="docs/mark.svg" width="40" height="40" alt="">\n\n# '), "the README opens with the mark above its title");
  const own = block(viewer, BLOCKS[1]) || "";
  ok(own.length > 1000, "the viewer has its own parts block");
  eq(own.match(/#[0-9a-fA-F]{3,8}\b/g) || [], [], "the viewer's own CSS uses tokens, never a hex colour");
  eq((own.match(/rgba?\([^)]*\)/g) || []).filter((c) => c !== "rgb(0 0 0 / 0.5)"), [], "the viewer's own CSS has no raw colour but the overlay scrim");
  eq(own.match(/var\(--(surface-|text-strong|text-default|text-subtle|primary\b|info|success|warning|danger|violet|ink|mut|acc|ok|bad)/g) || [], [],
    "the viewer's own CSS reads the kit's token names, not the old ones");
  eq((own.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || []).filter((d) => parseFloat(d.split(":")[1]) < 12), [], "no text in the viewer's own CSS is under 12px");
  ok(!/class:"btn|class="btn /.test(viewer), "the viewer's buttons are the kit's ex-btn");

  // Light by default, whatever the OS says; dark is the reader's choice.
  ok(!bootTheme(viewer), "the viewer starts light with nothing stored");
  ok(bootTheme(viewer, { stored: { "ex-theme": "dark" } }), "a stored dark choice (ex-theme) is honoured");
  ok(!bootTheme(viewer, { search: "?theme=light", stored: { "ex-theme": "dark" } }), "?theme=light overrides a stored choice");
  ok(bootTheme(viewer, { stored: { "screenmap-theme": "dark" } }), "a dark choice made in an earlier Screen Map carries over");
  ok(!bootTheme(viewer, { stored: { "screenmap-theme": "light" } }), "an earlier light choice stays light");

  // The styleguide draws with exactly the viewer's CSS.
  const guide = read("viewer/styleguide.html");
  ok(synced(viewer, guide) === guide, "viewer/styleguide.html is in sync with the viewer (npm run styleguide)");

  // The fixture site the standalone gate maps.
  const site = await startFixtureSite();
  try {
    const home = await (await fetch(site.base + "/")).text();
    ok(home.includes('href="/dashboard"') && home.includes('href="/reports"'), "the fixture site's home links like the fixture app's");
    ok(!home.includes("orphan-page"), "the fixture site never links to the orphan page");
    eq((await fetch(site.base + "/reports/q2")).status, 200, "the fixture site serves a dynamic report page");
    eq((await fetch(site.base + "/should-not-route")).status, 404, "the fixture site 404s an unknown path");
  } finally {
    await site.close();
  }
}
