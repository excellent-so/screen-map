// Degradation: with no optional config (no groups map, navBackbone, flows or coldStartPattern), the pipeline runs clean.
import { enumerate, deriveStaticEdges } from "../src/discovery/next-app-router.mjs";
import { buildGraph } from "../src/graph.mjs";
import { expandFlows, flows } from "../src/flows.mjs";
import { navBackbone, hasChrome } from "../src/nav.mjs";
import { setupWith, ok } from "./helpers.mjs";

export async function run() {
  // Fixture config supplies NO navBackbone, NO flows, NO coldStartPattern, NO groups map.
  await setupWith();

  ok(navBackbone().length === 0, "navBackbone degrades to none when unconfigured");
  ok(flows().length === 0, "flows degrade to none when unconfigured");

  const screens = enumerate();
  ok(screens.every((s) => s.capabilities.hasColdStart === false), "no coldStartPattern → hasColdStart never fires");

  // hasChrome: no noChromeRoots configured → any resolved screen bears chrome.
  const settings = screens.find((s) => s.route === "/settings");
  ok(hasChrome(settings) === true, "hasChrome true when noChromeRoots empty");
  ok(hasChrome({ ...settings, redirectTo: "/x" }) === false, "hasChrome false for a redirect stub");
  ok(hasChrome({ ...settings, resolved: false }) === false, "hasChrome false for unresolved screen");

  // The whole static pipeline must not throw with none of the optional config.
  let threw = false;
  try {
    expandFlows(screens);
    const graph = buildGraph(screens, { staticEdges: deriveStaticEdges(screens) });
    ok(graph.edges.length > 0, "graph produced edges on the generic path");
    ok(!graph.edges.some((e) => e.kind === "navbar"), "no navbar edges injected when backbone empty");
  } catch (e) {
    threw = true;
    ok(false, "generic pipeline threw: " + e.message);
  }
  ok(!threw, "generic pipeline runs without throwing (no navBackbone / flows)");
}
