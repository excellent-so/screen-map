// Output layer: finding schema, markdown adapter, github repo parsing, registry, the removed adapter.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFinding, findingMarkdown, findingTitle } from "../src/finding.mjs";
import { listOutputAdapters, getOutputAdapter, adapterProblem, sendFinding } from "../src/output/index.mjs";
import { resolveRepo } from "../src/output/github.mjs";
import * as markdown from "../src/output/markdown.mjs";
import { paths } from "../src/env.mjs";
import { setupFixture, ok, eq, includes } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FAKE_MAP = {
  build: { devBaseUrl: "http://localhost:3100" },
  screens: [
    { id: "dashboard", route: "/dashboard", url: "/dashboard", states: [{ state: "default", ok: true, shot: "shots/dashboard.default.png" }] },
    { id: "orphan-page", route: "/orphan-page", url: "/orphan-page", states: [] },
  ],
  orphans: ["orphan-page"],
  deadEnds: [],
  provenOrphans: ["orphan-page"],
};

export async function run() {
  await setupFixture();

  // Finding schema.
  const note = { id: "n_abc", screens: ["dashboard", "orphan-page"], direction: "issue", intent: "fix", body: "Empty state has no CTA back into onboarding." };
  const finding = buildFinding(note, FAKE_MAP);
  ok(finding.id.startsWith("f_"), "finding id is f_-prefixed");
  eq(finding.routes, ["/dashboard", "/orphan-page"], "finding routes derived from screen ids");
  includes(finding.urls, "http://localhost:3100/dashboard", "finding urls are live reproduction URLs");
  eq(finding.direction, "issue", "finding direction preserved");
  eq(finding.intent, "fix", "finding intent preserved");
  ok(finding.signals.orphan === true, "finding signal orphan derived from graph");
  ok(finding.signals.provenOrphan === true, "finding signal provenOrphan derived from graph");
  includes(finding.shots, ".screenmap/shots/dashboard.default.png", "finding shots point at the captured PNG");

  // Rendering.
  ok(findingTitle(finding).startsWith("[screen-map]"), "finding title tagged");
  const md = findingMarkdown(finding);
  ok(md.includes("Empty state has no CTA"), "finding markdown includes the body");
  ok(md.includes("`/dashboard`"), "finding markdown lists routes");

  // Registry.
  eq(listOutputAdapters(), ["markdown", "github"], "two output adapters registered: markdown and github");
  ok(getOutputAdapter("nope") === null, "unknown adapter → null");
  ok(getOutputAdapter("excellent") === null && getOutputAdapter("toString") === null, "no adapter by a removed or inherited name");
  ok(!fs.existsSync(path.join(ROOT, "src", "output", "excellent.mjs")), "the excellent adapter is gone from the source");
  eq(adapterProblem("markdown"), null, "markdown is a usable adapter");
  const removed = adapterProblem("excellent") || "";
  ok(/removed in 0\.2\.4/.test(removed) && removed.includes('"markdown"') && removed.includes('"github"') && !removed.includes("\n"),
    "a config naming the excellent adapter gets one line: removed in 0.2.4, use markdown or github");
  const sent = await sendFinding(finding, { adapter: "excellent" });
  ok(!sent.ok && sent.error === "removed-adapter" && sent.message === removed, "routing to the removed adapter fails with that line");

  // The CLI: a config that still says adapter "excellent" fails with that one line, no stack trace.
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "screen-map-removed-adapter-"));
  try {
    fs.mkdirSync(path.join(proj, "app"));
    fs.writeFileSync(path.join(proj, "screen-map.config.mjs"), 'export default { output: { adapter: "excellent" } };\n');
    const bin = path.join(ROOT, "bin", "screen-map.mjs");
    const run = spawnSync(process.execPath, [bin, "route"], { cwd: proj, encoding: "utf8", timeout: 30000 });
    eq(run.status, 1, "`screen-map route` with adapter \"excellent\" exits 1");
    eq(run.stderr.trim(), removed, "`screen-map route` prints only the one line");
    const flag = spawnSync(process.execPath, [bin, "route", "--adapter=excellent"], { cwd: proj, encoding: "utf8", timeout: 30000 });
    eq(flag.stderr.trim(), removed, "`--adapter=excellent` gets the same line");
    const doc = spawnSync(process.execPath, [bin, "doctor"], { cwd: proj, encoding: "utf8", timeout: 30000 });
    ok(doc.status === 0 && doc.stdout.includes(removed) && !/excellent-mcp/.test(doc.stdout), "`screen-map doctor` reports the removed adapter and checks for no excellent-mcp");
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }

  // GitHub repo parsing.
  eq(resolveRepo({ repo: "acme/widgets" }), "acme/widgets", "explicit repo honored");

  // Markdown adapter writes a findings file.
  const { OUT_DIR } = paths();
  const findingsFile = path.join(OUT_DIR, "findings.md");
  try { fs.rmSync(findingsFile, { force: true }); } catch { /* ignore */ }
  const r = await markdown.send(finding, { quiet: true });
  ok(r.ok, "markdown adapter returns ok");
  ok(fs.existsSync(findingsFile), "markdown adapter wrote findings.md");
  ok(fs.readFileSync(findingsFile, "utf8").includes("Empty state has no CTA"), "findings.md contains the finding");
  try { fs.rmSync(findingsFile, { force: true }); } catch { /* ignore */ }
}
