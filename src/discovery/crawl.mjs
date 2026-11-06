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
import { extractHrefs, normalizePath, patternToRegex } from "../lib.mjs";

/**
 * BFS the running server from `/`, following internal links. Returns:
 *   { reachedPaths: Set<string>, notPages: Map<string, string>, edges: [{ fromPath, toPath }], pageCount }
 *
 * `notPages` maps each reached path that isn't an HTML page of the app to the reason.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxPages]  crawl budget (default 200)
 * @param {function} [opts.log]
 */
export async function crawl(opts = {}) {
  const { maxPages = 200, log = () => {} } = opts;
  if (!hasChrome()) {
    log("crawl: no Chrome — skipping (proven-orphan report unavailable this run).");
    return { reachedPaths: new Set(), notPages: new Map(), edges: [], pageCount: 0, ran: false };
  }
  const base = devBaseUrl();
  const seed = "/";
  const queue = [seed];
  const visited = new Set([seed]);
  const reachedPaths = new Set(); // pages that actually loaded
  const notPages = new Map(); // reached, but not an HTML page of the app → why
  const edges = [];
  let pageCount = 0;

  while (queue.length && pageCount < maxPages) {
    const p = queue.shift();
    let dom = "";
    // Fetch first (this also warms a dev server's compile) to see what the URL serves.
    const res = await warmFetch(base + p);
    try { dom = await dumpDom(base + p, { profile: "crawl", virtualTime: 6000, warm: false }); } catch { /* unreachable */ }
    pageCount++;
    if (!dom) continue;
    reachedPaths.add(p);
    const why = notAPage(res, base);
    if (why) notPages.set(p, why);
    for (const raw of extractHrefs(dom)) {
      const to = normalizePath(raw);
      if (!to) continue;
      edges.push({ fromPath: p, toPath: to });
      if (!visited.has(to) && queue.length + visited.size < maxPages * 2) {
        visited.add(to);
        queue.push(to);
      }
    }
    if (pageCount % 10 === 0) log(`crawl: ${pageCount} pages · ${reachedPaths.size} reached`);
  }
  log(`crawl: done — ${pageCount} pages fetched, ${reachedPaths.size} reached, ${edges.length} link edges.`);
  return { reachedPaths, notPages, edges, pageCount, ran: true };
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
