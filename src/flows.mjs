// Screen Map — flows: expand declared multi-state flows the route walk can't see.
//
// A dynamic route like /welcome/[step] enumerates as ONE node, but is really an
// ORDERED sequence of distinct screens gated by app state. Declared flows fan it
// into concrete step screens with flow metadata (index/prev/next) the graph turns
// into a legible left-to-right sequence.
//
// Flows come from `config.flows`. With none configured this is a no-op (the
// state sweep in discovery/state-sweep.mjs finds most of these screens on its own).
//
// Two flow shapes:
//  - param flows  (`param`):      a dynamic [param] route fans into per-step ROUTES.
//  - state flows  (`stateParam`): a STATIC route hiding a client-side state machine
//    fans into per-state screens at the SAME route, each forced via
//    `?preview=1&<stateParam>=<slug>`. `transitions` [[from,to],…] declares the
//    real state graph in place of the linear prev→next sequence.

import { cfg } from "./env.mjs";
import { routeId, groupFor } from "./lib.mjs";

/** The declared flows for this app (from config; [] when unset). */
export function flows() {
  const f = cfg().flows;
  return Array.isArray(f) ? f : [];
}

/** Concrete route for a step: /welcome/[step] + 'info' → /welcome/info. */
function stepRoute(flowRoute, param, slug) {
  return flowRoute.replace(`[${param}]`, slug);
}

/** Expand declared flows IN PLACE. Mutates and returns `screens`. No-op if none. */
export function expandFlows(screens) {
  const declared = flows();
  if (!declared.length) return screens;
  const byRoute = new Map(screens.map((s) => [s.route, s]));

  for (const flow of declared) {
    const base = byRoute.get(flow.route);
    const inheritedFile = base ? base.file : null;
    const inheritedCaps = base
      ? base.capabilities
      : { hasLoading: false, hasColdStart: true, hasError: false };
    const grp = flow.group || (base ? base.group : groupFor(flow.route));

    const isStateFlow = Boolean(flow.stateParam);
    const previewParam = flow.previewParam || "preview";
    const steps = (flow.steps || []).map((slug, i) => {
      const route = isStateFlow ? flow.route : stepRoute(flow.route, flow.param, slug);
      return {
        id: isStateFlow ? `${routeId(flow.route)}__${slug}` : routeId(route),
        route,
        ...(isStateFlow ? { title: `${flow.route} · ${slug}` } : {}),
        file: inheritedFile,
        group: grp,
        dynamic: false,
        params: [],
        capabilities: inheritedCaps,
        url: isStateFlow
          ? `${flow.route}?${previewParam}=1&${flow.stateParam}=${encodeURIComponent(slug)}`
          : `${route}?${previewParam}=1`,
        resolved: true,
        resolveNote: "flow (preview)",
        redirectTo: null,
        states: [],
        discoveredBy: ["flow"],
        flow: {
          id: flow.id,
          step: slug,
          index: i,
          first: i === 0,
          last: i === flow.steps.length - 1,
          prevId: null,
          nextId: null,
        },
      };
    });

    if (Array.isArray(flow.transitions) && flow.transitions.length) {
      const idBySlug = new Map(steps.map((s) => [s.flow.step, s.id]));
      for (const s of steps) {
        s.flow.nextIds = flow.transitions
          .filter(([from]) => from === s.flow.step)
          .map(([, to]) => idBySlug.get(to))
          .filter(Boolean);
      }
    } else {
      for (let i = 0; i < steps.length; i++) {
        steps[i].flow.prevId = i > 0 ? steps[i - 1].id : null;
        steps[i].flow.nextId = i < steps.length - 1 ? steps[i + 1].id : null;
      }
    }
    const firstStep = steps[0] || null;

    if (base) {
      const at = screens.indexOf(base);
      screens.splice(at, 1, ...steps);
    } else {
      screens.push(...steps);
    }

    for (const entryRoute of flow.entries || []) {
      const s = byRoute.get(entryRoute);
      if (!s) continue;
      s.group = grp;
      s.coldOnly = true;
      s.redirectTo = firstStep ? firstStep.route : s.redirectTo;
      s.flow = { id: flow.id, entry: true, index: -1, nextId: firstStep ? firstStep.id : null };
    }

    (flow.related || []).forEach((relRoute, i) => {
      const s = byRoute.get(relRoute);
      if (!s) return;
      s.group = grp;
      s.flow = { id: flow.id, related: true, index: 100 + i };
    });
  }

  return screens;
}

/** Add the ordered step edges (+ entry edge) for expanded flows. Called from graph. */
export function flowEdges(screens, addEdge) {
  for (const s of screens) {
    const f = s.flow;
    if (!f) continue;
    if (f.nextId) addEdge(s.id, f.nextId, "step", "flow");
    if (f.nextIds) for (const to of f.nextIds) addEdge(s.id, to, "step", "flow");
  }
}
