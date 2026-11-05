// Screen Map — nav: the app's navigation backbone as optional config.
//
// Global nav (a top bar, a sidebar) links to pages that the source scan and the
// idle-DOM harvest can't see, so those pages would show up as false orphans.
// `config.navBackbone` lists the global-nav targets, and the graph adds an edge to
// each from every screen that shows the nav. Left out (the default), the graph adds
// no backbone edges.

import { cfg } from "./env.mjs";

/** The global navigation backbone — [{ to, label }]. Empty when unconfigured. */
export function navBackbone() {
  return cfg().navBackbone || [];
}

/** First path segment of a route ('' for '/'). */
export function rootSegment(route) {
  return route.split("/").filter(Boolean)[0] || "";
}

/**
 * Does the app's global chrome render on this screen? Backbone edges are only
 * injected from chrome-bearing screens. False for redirect stubs, unresolved
 * screens, and any route root in `config.noChromeRoots` (auth/takeover/public).
 */
export function hasChrome(screen) {
  if (screen.redirectTo) return false;
  if (!screen.resolved) return false;
  if (cfg().noChromeRoots.has(rootSegment(screen.route))) return false;
  return true;
}
