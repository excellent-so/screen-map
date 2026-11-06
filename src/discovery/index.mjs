// Screen Map — discovery: adapter registry + the walk ∪ crawl union.
//
// DiscoveryAdapter interface:
//   name: string
//   enumerate(): Screen[]                 — the router walk
//   deriveStaticEdges(screens): Edge[]    — literal targets from co-located source
//
// The union is what makes discovery = router-walk ∪ running-server crawl, and what
// turns the inferred orphan list into a PROVEN one (walk ∖ crawl-reached).

import { groupFor, routeId, patternToRegex } from "../lib.mjs";
import { matchRouteId } from "../discovery/next-app-router.mjs";
import { screenWasReached } from "./crawl.mjs";
import * as nextAppRouter from "./next-app-router.mjs";

const ADAPTERS = {
  "next-app-router": nextAppRouter,
};

/** The discovery adapter for a framework, or null if unknown (caller degrades). */
export function getDiscoveryAdapter(framework) {
  return ADAPTERS[framework] || null;
}

/** Register a custom adapter (extension point for future frameworks). */
export function registerDiscoveryAdapter(adapter) {
  if (adapter && adapter.name) ADAPTERS[adapter.name] = adapter;
}

/** Does any walk screen's route (exact, or as a pattern) cover the concrete path `p`? */
export function walkCovers(screens, p) {
  return screens.some((s) => s.route === p || patternToRegex(s.route).test(p));
}

/**
 * Fold a crawl result into the walk-discovered screens. Returns:
 *   { screens, provenOrphans, crawlOnly, crawlEdges }
 *
 *  - screens        walk screens (annotated `discoveredBy += "crawl"` when reached)
 *                   plus synthesized nodes for crawl-only routes. A node is `page: true`
 *                   when the crawl got an HTML page there (the build screenshots it), or
 *                   `page: false` with the reason as its default state (a stylesheet, a
 *                   feed, an error status, a redirect to another site)
 *  - provenOrphans  walk route ids the crawl never reached (real orphans, not inferred)
 *  - crawlOnly      reached paths matching no walk route (runtime-only routes)
 *  - crawlEdges     crawl link edges mapped to screen ids (validate the static graph)
 */
export function unionCrawl(screens, crawlResult) {
  if (!crawlResult || !crawlResult.ran) {
    return { screens, provenOrphans: [], crawlOnly: [], crawlEdges: [], crawlRan: false };
  }
  const { reachedPaths, edges } = crawlResult;
  const notPages = crawlResult.notPages || new Map();

  // 1. Annotate walk screens with crawl reachability; collect proven orphans.
  const provenOrphans = [];
  for (const s of screens) {
    if (screenWasReached(s, reachedPaths)) {
      if (!s.discoveredBy.includes("crawl")) s.discoveredBy.push("crawl");
    } else if (s.id !== "home") {
      provenOrphans.push(s.id);
    }
  }

  // 2. crawl-only routes: reached paths that match no walk screen → synthesized nodes.
  const crawlOnly = [...reachedPaths].filter((p) => !walkCovers(screens, p));
  const synthesized = crawlOnly.map((p) => ({
    id: routeId(p),
    route: p,
    file: null,
    group: groupFor(p),
    dynamic: false,
    params: [],
    capabilities: { hasLoading: false, hasColdStart: false, hasError: false },
    url: p,
    resolved: true,
    resolveNote: "crawl (runtime-only)",
    states: notPages.has(p) ? [{ state: "default", capture: false, reason: notPages.get(p) }] : [],
    discoveredBy: ["crawl"],
    crawlOnly: true,
    page: !notPages.has(p),
  }));
  const allScreens = [...screens, ...synthesized];

  // 3. crawl edges mapped to screen ids (over the full node set).
  const seen = new Set();
  const crawlEdges = [];
  for (const e of edges) {
    const from = matchRouteId(e.fromPath, allScreens);
    const to = matchRouteId(e.toPath, allScreens);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    crawlEdges.push({ from, to, kind: "crawl", source: "crawl" });
  }

  return { screens: allScreens, provenOrphans, crawlOnly, crawlEdges, crawlRan: true };
}
