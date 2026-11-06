// Screen Map — graph: assemble the navigation graph and derive the audit signals.
//
// Edge sources, unioned:
//   • static  — literal targets from co-located source (DiscoveryAdapter.deriveStaticEdges)
//   • dom     — rendered-DOM <a href> harvested at capture time (s.outLinks)
//   • redirect— a redirect stub → where it actually lands (s.redirectTo)
//   • crawl   — running-server crawl link edges, for pairs nothing else links
//   • navbar  — the optional config.navBackbone injected from chrome-bearing screens
//   • step    — declared flow sequences
//
// Signals: orphans (no way in, and never a screen the crawl reached), dead-ends (no way
// out), cross-group jumps.

import { matchRouteId } from "./discovery/next-app-router.mjs";
import { navBackbone, hasChrome } from "./nav.mjs";
import { flowEdges } from "./flows.mjs";
import { stateEdges } from "./discovery/state-sweep.mjs";

export function buildGraph(screens, { staticEdges = [], crawlEdges = [] } = {}) {
  const edgeSet = new Map();
  const byId = new Map(screens.map((s) => [s.id, s]));
  const addEdge = (from, to, kind, source) => {
    if (!to || to === from || !byId.has(to)) return;
    const key = `${from}|${to}|${kind}`;
    if (!edgeSet.has(key)) edgeSet.set(key, { from, to, kind, source });
  };

  // Redirect stubs + rendered-DOM nav targets (the real links the app SHOWS).
  for (const s of screens) {
    if (s.redirectTo) addEdge(s.id, matchRouteId(s.redirectTo, screens), "redirect", "runtime");
    if (s.outLinks) for (const h of s.outLinks) addEdge(s.id, matchRouteId(h, screens), "link", "dom");
  }
  // Static source-scan edges (from the discovery adapter).
  for (const e of staticEdges) addEdge(e.from, e.to, e.kind, e.source);
  // Crawl link edges, only where nothing above already links the pair: the crawl sees the
  // same rendered links as the DOM harvest, and a second copy of every sidebar link would
  // stay drawn when the viewer hides global nav.
  const linked = new Set([...edgeSet.values()].map((e) => `${e.from}|${e.to}`));
  for (const e of crawlEdges) if (!linked.has(`${e.from}|${e.to}`)) addEdge(e.from, e.to, e.kind, e.source);

  const edges = [...edgeSet.values()];

  // Fan-in relabel: a target reachable from a large fraction of screens is global
  // chrome (a nav bar), not a content flow — relabel those `link` (and `crawl`) edges
  // `nav` so the viewer can hide them and the real per-screen flows stay legible.
  const harvested = screens.filter((s) => (s.outLinks && s.outLinks.length) || s.redirectTo).length || screens.length;
  const navThreshold = Math.max(6, harvested * 0.35);
  const linkish = (e) => e.kind === "link" || e.kind === "crawl";
  const inFan = {};
  for (const e of edges) if (linkish(e)) inFan[e.to] = (inFan[e.to] || 0) + 1;
  for (const e of edges) if (linkish(e) && inFan[e.to] >= navThreshold) e.kind = "nav";

  // Inject the optional navigation backbone as first-class 'navbar' edges (deduped
  // against any harvested nav/link edge). No-op when config.navBackbone is empty.
  const pairSeen = new Set(edges.map((e) => `${e.from}|${e.to}`));
  const backboneIds = navBackbone()
    .map((t) => ({ id: matchRouteId(t.to, screens), label: t.label }))
    .filter((t) => t.id);
  for (const s of screens) {
    if (!hasChrome(s)) continue;
    for (const t of backboneIds) {
      if (t.id === s.id) continue;
      if (pairSeen.has(`${s.id}|${t.id}`)) continue;
      addEdge(s.id, t.id, "navbar", "backbone");
    }
  }

  // Ordered flow edges (entry→step0, stepN→stepN+1) from flow metadata.
  flowEdges(screens, addEdge);
  // Ordered state-axis edges (base→state0, stateN→stateN+1) from auto-discovered sweep.
  stateEdges(screens, addEdge);

  const allEdges = [...edgeSet.values()];
  const inbound = new Set(allEdges.map((e) => e.to));
  const outbound = new Set(allEdges.map((e) => e.from));
  // A screen the crawl reached has a way in by definition, so it is never an orphan.
  const crawled = (s) => Array.isArray(s.discoveredBy) && s.discoveredBy.includes("crawl");
  const orphans = screens.filter((s) => !inbound.has(s.id) && s.id !== "home" && !crawled(s)).map((s) => s.id);
  const deadEnds = screens.filter((s) => !outbound.has(s.id)).map((s) => s.id);
  for (const e of allEdges) {
    const f = byId.get(e.from), t = byId.get(e.to);
    e.crossGroup = Boolean(f && t && f.group !== t.group);
  }
  return { edges: allEdges, orphans, deadEnds };
}
