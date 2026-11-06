// Screen Map — discovery adapter: running-server crawl (the portability layer).
//
// Framework-agnostic. Renders the real running app (dynamic `[slug]` pages render
// for real), follows internal links breadth-first, and records which routes it
// actually reached. Works beyond Next (Remix/SvelteKit/Nuxt/Astro) through one path.
//
// Its VALUE next to the router-walk:
//   walk ∪ crawl        = the complete node set
//   walk ∖ crawl-reached = the PROVEN orphan report (a coded route nothing links to)
//   crawl ∖ walk        = runtime-only routes the static walk didn't model
//
// The crawl edges also fill in links the DOM harvest and the source scan didn't see.
//
// It also notes which reached URLs aren't pages of the app (a stylesheet, a feed, an
// error status, a redirect to another site), so the build doesn't screenshot them.

import { dumpDom, hasChrome, warmFetch } from "../browser.mjs";
import { devBaseUrl } from "../env.mjs";
import { extractLinks, normalizePath, patternToRegex } from "../lib.mjs";

/**
 * BFS the running server from `/`, following internal links. Returns:
 *   { reachedPaths: Set<string>, notPages: Map<string, string>, redirects: Map<string, string>,
 *     urls: Map<string, string>, edges: [{ fromPath, toPath }], pageCount, ran }
 *
 * `notPages` maps each reached path that isn't an HTML page of the app to the reason.
 * `redirects` maps a path that redirects within the app to where it lands ("/about.html" →
 * "/about" on a server with clean URLs); the crawl follows it and maps the page it lands on.
 * `urls` keeps each reached path as it was linked when that differs ("/blog" → "/blog/"),
 * so a directory's relative links resolve the way they do in a browser.
 * `ran` is false when not even one page loaded: a crawl that reached nothing proves nothing.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxPages]  crawl budget (default 200)
 * @param {function} [opts.log]
 */
export async function crawl(opts = {}) {
  const { maxPages = 200, log = () => {} } = opts;
  const empty = { reachedPaths: new Set(), notPages: new Map(), redirects: new Map(), urls: new Map(), edges: [], pageCount: 0, ran: false };
  if (!hasChrome()) {
    log("crawl: no Chrome — skipping (proven-orphan report unavailable this run).");
    return empty;
  }
  const base = devBaseUrl();
  const queue = [{ path: "/", href: "/" }];
  const visited = new Set(["/"]);
  const reachedPaths = new Set(); // pages that actually loaded
  const notPages = new Map(); // reached, but not an HTML page of the app → why
  const redirects = new Map(); // requested path → the path in the app it redirects to
  const urls = new Map(); // reached path → its pathname as linked, when that differs
  const edges = [];
  let pageCount = 0;

  while (queue.length && pageCount < maxPages) {
    const { path: p, href } = queue.shift();
    // Fetch first (this also warms a dev server's compile) to see what the URL serves.
    const res = await warmFetch(base + href);
    pageCount++;
    let at = p, atHref = href;
    const landed = pathInApp(res, base);
    if (landed && landed.path !== p) {
      // A redirect within the app: the page is where it lands.
      redirects.set(p, landed.path);
      if (res.status < 400) reachedPaths.add(p);
      if (visited.has(landed.path)) continue; // that page is crawled on its own
      visited.add(landed.path);
      at = landed.path;
    }
    if (landed) atHref = landed.href;
    let dom = "";
    try { dom = await dumpDom(base + atHref, { profile: "crawl", virtualTime: 6000, warm: false }); } catch { /* unreachable */ }
    if (!dom) continue;
    reachedPaths.add(at);
    if (atHref !== at) urls.set(at, atHref);
    const why = notAPage(res, base);
    if (why) notPages.set(at, why);
    for (const link of extractLinks(dom, (res.ok && res.finalUrl) || base + atHref)) {
      edges.push({ fromPath: at, toPath: link.path });
      if (!visited.has(link.path) && queue.length + visited.size < maxPages * 2) {
        visited.add(link.path);
        queue.push(link);
      }
    }
    if (pageCount % 10 === 0) log(`crawl: ${pageCount} pages · ${pagesIn(reachedPaths, redirects)} reached`);
  }
  if (!reachedPaths.size) {
    log(`crawl: no page loaded from ${base}/ — skipping the proven-orphan report this run.`);
    return { ...empty, pageCount };
  }
  log(`crawl: done — ${pageCount} pages fetched, ${pagesIn(reachedPaths, redirects)} reached, ${edges.length} link edges.`);
  return { reachedPaths, notPages, redirects, urls, edges, pageCount, ran: true };
}

/** How many reached paths are pages, not a path that redirects to one. */
const pagesIn = (reached, redirects) => [...reached].filter((p) => !redirects.has(p)).length;

/** Where a fetch landed, when that is in the app (same origin): { path, href }, else null. */
function pathInApp(res, base) {
  if (!res || !res.ok || !res.finalUrl) return null;
  try {
    const to = new URL(res.finalUrl);
    if (to.origin !== new URL(base).origin) return null;
    const p = normalizePath(to.pathname);
    return p ? { path: p, href: to.pathname } : null;
  } catch { return null; }
}

/**
 * Why a crawled URL gets no screenshot, or null when it served an HTML page of the app.
 * `res` is warmFetch()'s result. A fetch that failed says nothing, so the capture may try.
 */
export function notAPage(res, base) {
  if (!res || !res.ok) return null;
  if (res.status >= 400) return `Not a page (answered ${res.status})`;
  try {
    const to = new URL(res.finalUrl);
    if (to.origin !== new URL(base).origin) return `Not a page (redirects to ${to.host})`;
  } catch { /* no final URL to compare */ }
  const type = String(res.contentType || "").split(";")[0].trim().toLowerCase();
  if (type && type !== "text/html" && type !== "application/xhtml+xml") return `Not a page (${type})`;
  return null;
}

/** Does a walk-discovered screen's route pattern match any reached concrete path? */
export function screenWasReached(screen, reachedPaths) {
  if (reachedPaths.has(screen.route)) return true;
  const re = patternToRegex(screen.route);
  for (const p of reachedPaths) if (re.test(p)) return true;
  return false;
}
