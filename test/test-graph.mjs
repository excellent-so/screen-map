// Graph: orphan + dead-end detection over the fixture (the headline signals).
import { enumerate, deriveStaticEdges } from "../src/discovery/next-app-router.mjs";
import { buildGraph } from "../src/graph.mjs";
import { expandFlows } from "../src/flows.mjs";
import { unionCrawl } from "../src/discovery/index.mjs";
import { routeId } from "../src/lib.mjs";
import { setupFixture, ok, eq, includes, excludes } from "./helpers.mjs";

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

  // Global nav: the crawl sees the same sidebar links as the DOM harvest. Its copies must not stay
  // drawn when the viewer hides nav, and a nav link only the crawl saw is nav too.
  const pages = ["/", "/a", "/b", "/c", "/d", "/e", "/f", "/g"];
  const mk = (route, outLinks) => ({ id: routeId(route), route, group: route.split("/")[1] || "root", dynamic: false, resolved: true, discoveredBy: ["router-walk", "crawl"], outLinks });
  const nav = [...pages.map((p) => mk(p, ["/settings"])), mk("/settings", []), mk("/help", [])];
  const crawlNav = [
    ...pages.map((p) => ({ from: routeId(p), to: "settings", kind: "crawl", source: "crawl" })), // copies of the DOM's sidebar link
    ...pages.map((p) => ({ from: routeId(p), to: "help", kind: "crawl", source: "crawl" })), // a sidebar link only the crawl saw
    { from: "a", to: "b", kind: "crawl", source: "crawl" }, // one page's own link
  ];
  const ng = buildGraph(nav, { crawlEdges: crawlNav });
  const into = (id) => ng.edges.filter((e) => e.to === id);
  eq(into("settings").length, pages.length, "a link the DOM and the crawl both saw is one edge, not two");
  ok(into("settings").every((e) => e.kind === "nav" && e.source === "dom"), "the sidebar link the DOM saw is a nav edge");
  ok(into("help").length === pages.length && into("help").every((e) => e.kind === "nav"), "a sidebar link only the crawl saw is a nav edge too, so the toggle hides it");
  eq(ng.edges.filter((e) => e.kind === "crawl").map((e) => `${e.from}→${e.to}`), ["a→b"], "a page's own link the crawl alone found stays a crawl edge");
  excludes(ng.orphans, "settings", "deduplicating crawl edges doesn't orphan the nav target");
}
