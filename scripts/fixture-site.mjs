// A tiny static HTML site that mirrors the committed fixture app (fixture/app): the same routes and
// the same links between them, as plain pages. It needs no framework and no install, so a map of it
// can be built anywhere Node and Chrome are. Used by test-standalone.mjs.
//
//   import { startFixtureSite } from "./fixture-site.mjs";
//   const site = await startFixtureSite();   // { base, port, close() } on a free 127.0.0.1 port

import http from "node:http";

// Each page and the links it shows. Keep in step with the <Link href> targets in fixture/app.
const PAGES = [
  { match: "/", title: "Home", lede: "The fixture app's front page.", links: [["/dashboard", "Dashboard"], ["/settings", "Settings"], ["/reports", "Reports"]] },
  { match: "/dashboard", title: "Dashboard", lede: "This week at a glance.", links: [["/reports", "See reports"]] },
  { match: "/settings", title: "Settings", lede: "Account and workspace settings.", links: [["/", "Home"], ["/about", "About"]] },
  { match: "/about", title: "About", lede: "No way out from here.", links: [] },
  { match: "/reports", title: "Reports", lede: "Every report, newest first.", links: [["/reports/q1", "Report q1"], ["/reports/q2", "Report q2"], ["/reports/q3", "Report q3"]] },
  { match: /^\/reports\/[^/]+$/, title: "Report", lede: "One report.", links: [["/reports", "Back to all reports"]] },
  { match: "/orphan-page", title: "Orphaned settings page", lede: "Nothing links here.", links: [["/", "Home"]] },
  { match: "/board", title: "Board", lede: "Open, closed and archived items.", links: [] },
  { match: "/search", title: "Search", lede: "Results for your query.", links: [] },
  { match: "/tour", title: "Tour", lede: "A short tour of the app.", links: [] },
  { match: /^\/wizard\/[^/]+$/, title: "Wizard", lede: "Set up your workspace, one step at a time.", links: [] },
];

function pageFor(pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return PAGES.find((pg) => (typeof pg.match === "string" ? pg.match === p : pg.match.test(p))) || null;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function html(page, pathname) {
  const title = page.title === "Report" || page.title === "Wizard" ? `${page.title} ${pathname.split("/").pop()}` : page.title;
  const links = page.links.map(([href, label]) => `<a class="link" href="${href}">${esc(label)}</a>`).join("");
  const rows = [72, 56, 64].map((w) => `<div class="row"><i style="width:${w}%"></i></div>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · Fixture app</title>
<style>
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #18181b; background: #fafafa; }
  .bar { height: 56px; display: flex; align-items: center; padding: 0 40px; border-bottom: 1px solid #e4e4e7; background: #fff; font-weight: 600; }
  main { max-width: 960px; padding: 48px 40px; }
  h1 { margin: 0 0 8px; font-size: 40px; letter-spacing: -0.02em; }
  p { margin: 0 0 32px; color: #52525b; font-size: 18px; }
  .links { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 40px; }
  .link { padding: 12px 18px; border: 1px solid #d4d4d8; border-radius: 6px; background: #fff; color: #18181b; text-decoration: none; font-weight: 500; }
  .card { border: 1px solid #e4e4e7; border-radius: 8px; background: #fff; padding: 24px; }
  .row { height: 18px; margin: 14px 0; } .row i { display: block; height: 100%; border-radius: 4px; background: #e4e4e7; }
</style></head>
<body><div class="bar">Fixture app</div>
<main><h1>${esc(title)}</h1><p>${esc(page.lede)}</p>
<div class="links">${links}</div>
<div class="card">${rows}</div></main></body></html>`;
}

/** Serve the fixture site on a free port. Resolves to { base, port, close }. */
export function startFixtureSite({ host = "127.0.0.1", port = 0 } = {}) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    const page = req.method === "GET" || req.method === "HEAD" ? pageFor(pathname) : null;
    if (!page) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : html(page, pathname));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        base: `http://${host}:${actual}`,
        close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
      });
    });
  });
}

// `node scripts/fixture-site.mjs [port]` serves it in the foreground (Ctrl-C to stop).
if (import.meta.url === `file://${process.argv[1]}`) {
  const site = await startFixtureSite({ port: Number(process.argv[2]) || 0 });
  console.log(`fixture site: ${site.base}`);
}
