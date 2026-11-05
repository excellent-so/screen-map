// Graph: orphan + dead-end detection over the fixture (the headline signals).
import { enumerate, deriveStaticEdges } from "../src/discovery/next-app-router.mjs";
import { buildGraph } from "../src/graph.mjs";
import { expandFlows } from "../src/flows.mjs";
import { unionCrawl } from "../src/discovery/index.mjs";
import { setupFixture, ok, includes, excludes } from "./helpers.mjs";

export async function run() {
  await setupFixture();
  const screens = enumerate();
  expandFlows(screens); // no-op (no flows configured) — must not throw
  const staticEdges = deriveStaticEdges(screens);
  const graph = buildGraph(screens, { staticEdges });

  includes(graph.orphans, "orphan-page", "orphan-page reported as an orphan (nothing links to it)");
  excludes(graph.orphans, "home", "home is never an orphan");
  excludes(graph.orphans, "dashboard", "dashboard reachable → not an orphan");
  includes(graph.deadEnds, "about", "/about reported as a dead-end (no outbound links)");
  excludes(graph.deadEnds, "home", "home has outbound links → not a dead-end");

  const has = (from, to) => graph.edges.some((e) => e.from === from && e.to === to);
  ok(has("home", "dashboard"), "graph edge home → dashboard");
  ok(has("reports", "reports__d_id"), "graph edge reports → reports/[id]");

  // crossGroup flagging: home (group "root") → dashboard (group "dashboard").
  const cross = graph.edges.find((e) => e.from === "home" && e.to === "dashboard");
  ok(cross && cross.crossGroup === true, "home→dashboard flagged crossGroup");

  // unionCrawl with no crawl → passthrough, no proven orphans.
  const u = unionCrawl(screens, { ran: false });
  ok(u.provenOrphans.length === 0 && u.crawlRan === false, "unionCrawl passthrough when crawl didn't run");

  // unionCrawl with a synthetic crawl result → proven-orphan report (walk ∖ crawl-reached).
  const reached = new Set(["/", "/dashboard", "/reports", "/settings", "/about"]);
  const u2 = unionCrawl(screens, { ran: true, reachedPaths: reached, edges: [{ fromPath: "/", toPath: "/dashboard" }] });
  includes(u2.provenOrphans, "orphan-page", "proven orphan: orphan-page never reached by crawl");
  ok(!u2.provenOrphans.includes("dashboard"), "dashboard reached by crawl → not a proven orphan");
  ok(u2.crawlEdges.some((e) => e.from === "home" && e.to === "dashboard"), "crawl edge mapped to ids");
}
