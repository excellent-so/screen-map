// State-sweep: auto-discover hidden state-machine screens from route source —
// the general replacement for hand-authored `config.flows`.
import { enumerate } from "../src/discovery/next-app-router.mjs";
import { buildGraph } from "../src/graph.mjs";
import {
  readsSearchParams, unionTypes, arrayInner, topLevelElements, stringArrayElements,
  arrayLength, inferDomain, sweepParamStates, stateEdges,
} from "../src/discovery/state-sweep.mjs";
import { deriveStaticEdges } from "../src/discovery/next-app-router.mjs";
import { setupFixture, ok, eq, includes, excludes } from "./helpers.mjs";

const PREVIEW = { statePreview: { param: "preview", value: "1" } };

export async function run() {
  // ── pure source scanners ────────────────────────────────────────────────
  const pageType = `searchParams: Promise<{ mode?: string; slide?: string; step?: string }>`;
  eq(readsSearchParams(pageType).sort(), ["mode", "slide", "step"], "readsSearchParams: object-type annotation");
  eq(readsSearchParams(`const { view, tab } = await searchParams;`).sort(), ["tab", "view"], "readsSearchParams: destructure");
  eq(readsSearchParams(`const v = searchParams.get("layout");`), ["layout"], "readsSearchParams: .get()");
  eq(readsSearchParams(`const x = 1;`), [], "readsSearchParams: none when unused");

  eq(unionTypes(`type Mode = "slideshow" | "tour";`), { Mode: ["slideshow", "tour"] }, "unionTypes: string union parsed");
  ok(!("Foo" in unionTypes(`type Foo = string | number;`)), "unionTypes: non-string-literal union ignored");

  eq(topLevelElements(`{a:1}, {b:[1,2]}, {c:3}`).length, 3, "topLevelElements: nested brackets don't split");
  eq(stringArrayElements(`const S = ["a", "b-c", "d"];`, "S"), ["a", "b-c", "d"], "stringArrayElements: pure string array");
  ok(stringArrayElements(`const S = [{x:1},{x:2}];`, "S") === null, "stringArrayElements: object array → null");
  eq(arrayLength(`const SLIDES = [ {t:1}, {t:2}, {t:3} ];`, "SLIDES"), 3, "arrayLength: counts top-level object elements");
  ok(arrayInner(`const Q = [1,2];`, "MISSING") === null, "arrayInner: missing array → null");

  // ── inferDomain: one per strategy ───────────────────────────────────────
  const modeSrc = `type Mode = "slideshow" | "tour"; const [mode] = useState<Mode>(initialMode === "tour" ? "tour" : "slideshow");`;
  eq(inferDomain("mode", modeSrc), { kind: "enum", values: ["slideshow", "tour"], via: "union-type" }, "inferDomain: union-type linked to param");
  const typedSrc = `type Tab = "profile" | "billing" | "team";\nexport default async function P({ searchParams }: { searchParams: Promise<{ tab?: Tab }> }) {\n  const { tab = "profile" } = await searchParams;\n  return tab;\n}`;
  eq(inferDomain("tab", typedSrc), { kind: "enum", values: ["profile", "billing", "team"], via: "union-type" }, "inferDomain: a param declared with a string-union type takes its values");
  ok(inferDomain("q", `type Tab = "a" | "b";\nconst x: { q?: string } = {};`) === null, "inferDomain: a union type the param isn't declared with doesn't count");

  const incSrc = `const VALID_STEPS = ["a", "b", "c"]; if (!VALID_STEPS.includes(step)) notFound();`;
  eq(inferDomain("step", incSrc, { dynamic: true }), { kind: "enum", values: ["a", "b", "c"], via: "includes-array" }, "inferDomain: ARR.includes(param)");

  const numSrc = `const SLIDES = [{a:1},{a:2},{a:3}]; const n = Number(initialSlide); const s = SLIDES[slide];`;
  eq(inferDomain("slide", numSrc), { kind: "numeric", values: ["0", "1", "2"], via: "index-array" }, "inferDomain: numeric index axis 0..n-1");

  const eqSrc = `const t = tab === "open" ? 1 : tab === "closed" ? 2 : 3;`;
  eq(inferDomain("tab", eqSrc).values.sort(), ["closed", "open"], "inferDomain: equality-literal fallback");

  ok(inferDomain("q", `const r = q ?? "";`) === null, "inferDomain: free-text param → null (no false positive)");

  const supersetSrc = `const AUTH_STATES = ["welcome","login","register","recover","codes","signed-in"] as const; if (mode === "login") x(); if (mode === "recover") y();`;
  eq(inferDomain("mode", supersetSrc), { kind: "enum", values: ["welcome", "login", "register", "recover", "codes", "signed-in"], via: "enum-superset" }, "inferDomain: equality subset adopts the full as-const enum array");

  // ── end-to-end sweep over the fixture (with a preview seam) ──────────────
  await setupFixture(PREVIEW);
  let screens = enumerate();
  const res = sweepParamStates(screens);
  const byId = (id) => screens.find((s) => s.id === id);
  const stateOf = (route) => screens.filter((s) => s.route === route && s.state);

  // (1) multi-axis query route: base kept + mode(2)+slide(3)+step(6) = 11 states.
  const tourStates = stateOf("/tour");
  ok(byId("tour") && !byId("tour").state, "tour base screen kept (bare URL = default state)");
  eq(tourStates.length, 11, "tour swept into 11 states (mode 2 + slide 3 + step 6)");
  eq(tourStates.filter((s) => s.state.param === "mode").map((s) => s.state.value).sort(), ["slideshow", "tour"], "tour mode axis = slideshow|tour (union-type)");
  eq(tourStates.filter((s) => s.state.param === "slide").length, 3, "tour slide axis = 3 (numeric)");
  eq(tourStates.filter((s) => s.state.param === "step").length, 6, "tour step axis = 6 (numeric)");
  ok(tourStates.every((s) => s.discoveredBy.includes("state-sweep")), "state screens tagged discoveredBy state-sweep");

  // (2) NOT gated → honors its own params → NO preview forcing even though seam is set.
  const modeTour = tourStates.find((s) => s.state.param === "mode" && s.state.value === "tour");
  eq(modeTour.url, "/tour?mode=tour", "ungated route: url is plain ?param=value, no preview injected");
  eq(modeTour.title, "/tour · mode=tour", "state screen carries a readable title");

  // (3) dynamic gated route: base REPLACED by per-step routes, forced via ?preview=1.
  ok(!byId("wizard__d_step"), "wizard [step] base replaced (the pattern node was never a real screen)");
  const wsteps = screens.filter((s) => s.route.startsWith("/wizard/") && s.state);
  eq(wsteps.map((s) => s.route), ["/wizard/intro", "/wizard/details", "/wizard/review", "/wizard/done"], "wizard fanned into its VALID_STEPS, in source order");
  eq(byId("wizard__intro").url, "/wizard/intro?preview=1", "gated route: swept states forced through the preview seam");

  // (4) equality-literal enum on a static route.
  eq(stateOf("/board").map((s) => s.state.value).sort(), ["archived", "closed", "open"], "board tab axis via equality literals");

  // (5) negatives: no confident domain / no searchParams → no sweep.
  eq(stateOf("/search").length, 0, "free-text /search NOT swept");
  eq(stateOf("/settings").length, 0, "param-less /settings NOT swept");

  // (6) edges: swept states are sequenced and never orphaned.
  const graph = buildGraph(screens, { staticEdges: deriveStaticEdges(screens) });
  const has = (from, to) => graph.edges.some((e) => e.from === from && e.to === to);
  ok(has("wizard__intro", "wizard__details"), "wizard step chain edge intro→details");
  ok(has("tour", tourStates.find((s) => s.state.first && s.state.param === "mode").id), "tour base → first mode state (entry edge)");
  // Every state screen wired into the graph (base→first for query axes, prev→next
  // within an axis) is reachable. The lone honest exception is the FIRST step of a
  // path-replaced axis when nothing linked to the original dynamic route — exactly
  // as a declared flow's first step is orphaned without an entry.
  const spurious = graph.orphans
    .map((id) => byId(id))
    .filter((s) => s?.state && !(s.state.kind === "path" && s.state.first));
  eq(spurious.map((s) => s.id), [], "no wired state screen is spuriously orphaned (query axes reach from base; steps chain)");

  // ── caps: maxPerRoute truncates + reports ───────────────────────────────
  await setupFixture({ ...PREVIEW, stateSweep: { maxPerRoute: 2 } });
  screens = enumerate();
  const capped = sweepParamStates(screens);
  eq(screens.filter((s) => s.route === "/tour" && s.state && s.state.param === "step").length, 2, "maxPerRoute caps the step axis to 2");
  ok(capped.truncated > 0, "cap reports truncated values (no silent truncation)");

  // ── kill switch: stateSweep:false → nothing swept ───────────────────────
  await setupFixture({ stateSweep: false });
  screens = enumerate();
  const off = sweepParamStates(screens);
  eq(off.swept, 0, "stateSweep:false disables the sweep entirely");
  ok(!screens.some((s) => s.state), "no state screens when disabled");

  // ── no preview seam: gated route still swept, just unforced (honest) ─────
  await setupFixture(); // no statePreview
  screens = enumerate();
  sweepParamStates(screens);
  const wIntro = screens.find((s) => s.route === "/wizard/intro");
  ok(wIntro && wIntro.url === "/wizard/intro", "without a preview seam, gated states are still discovered (unforced url)");

  ok(res.swept > 0, `sweep produced ${res.swept} state screens across ${res.routes} routes`);
}
