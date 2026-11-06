// Screen Map — test runner. Zero-dep; runs every suite against the fixture app.
import { report } from "./helpers.mjs";
import * as config from "./test-config.mjs";
import * as discovery from "./test-discovery.mjs";
import * as stateSweep from "./test-state-sweep.mjs";
import * as graph from "./test-graph.mjs";
import * as degradation from "./test-degradation.mjs";
import * as output from "./test-output.mjs";
import * as chrome from "./test-chrome.mjs";
import * as server from "./test-server.mjs";
import * as launch from "./test-launch.mjs";
import * as crawlCapture from "./test-crawl-capture.mjs";
import * as reviewLoop from "./test-review-loop.mjs";

const suites = [
  ["config", config],
  ["discovery", discovery],
  ["state-sweep", stateSweep],
  ["graph", graph],
  ["degradation", degradation],
  ["output", output],
  ["chrome", chrome],
  ["server", server],
  ["launch", launch],
  ["crawl capture", crawlCapture],
  ["review loop", reviewLoop],
];

for (const [name, suite] of suites) {
  console.log(`\n▶ ${name}`);
  try { await suite.run(); }
  catch (e) { console.error(`  ✗ suite threw: ${e.stack || e.message}`); process.exitCode = 1; }
}

const { failed } = report("screen-map tests");
if (failed > 0) process.exitCode = 1;
