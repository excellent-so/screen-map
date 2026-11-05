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
// The crawl edges also VALIDATE the statically-derived graph.

import { dumpDom, hasChrome } from "../browser.mjs";
import { devBaseUrl } from "../env.mjs";
import { extractHrefs, normalizePath, patternToRegex } from "../lib.mjs";

/**
 * BFS the running server from `/`, following internal links. Returns:
 *   { reachedPaths: Set<string>, edges: [{ fromPath, toPath }], pageCount }
 *
 * @param {object} [opts]
 * @param {number} [opts.maxPages]  crawl budget (default 200)
 * @param {function} [opts.log]
 */
export async function crawl(opts = {}) {
  const { maxPages = 200, log = () => {} } = opts;
  if (!hasChrome()) {
    log("crawl: no Chrome — skipping (proven-orphan report unavailable this run).");
    return { reachedPaths: new Set(), edges: [], pageCount: 0, ran: false };
  }
  const base = devBaseUrl();
  const seed = "/";
  const queue = [seed];
  const visited = new Set([seed]);
  const reachedPaths = new Set(); // pages that actually loaded
  const edges = [];
  let pageCount = 0;

  while (queue.length && pageCount < maxPages) {
    const p = queue.shift();
    let dom = "";
    try { dom = await dumpDom(base + p, { profile: "crawl", virtualTime: 6000 }); } catch { /* unreachable */ }
    pageCount++;
    if (!dom) continue;
    reachedPaths.add(p);
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
  return { reachedPaths, edges, pageCount, ran: true };
}

/** Does a walk-discovered screen's route pattern match any reached concrete path? */
export function screenWasReached(screen, reachedPaths) {
  if (reachedPaths.has(screen.route)) return true;
  const re = patternToRegex(screen.route);
  for (const p of reachedPaths) if (re.test(p)) return true;
  return false;
}
