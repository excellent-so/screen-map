// Screen Map — serve: a tiny static server for the viewer + save/refresh/route hooks.
// Serving over http (not file://) avoids browser CSP/fetch quirks and lets the viewer
// PUT notes back to disk so annotations save instantly in any browser.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { paths } from "./env.mjs";
import { readJson } from "./lib.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".js": "text/javascript", ".css": "text/css",
};

function readBody(req, res, limit, cb) {
  let body = "";
  req.on("error", () => { try { res.writeHead(400); res.end(); } catch { /* ignore */ } });
  req.on("data", (c) => { body += c; if (body.length > limit) req.destroy(); });
  req.on("end", () => cb(body));
}

export function serve({ port = 4610, open = false } = {}) {
  const { OUT_DIR, NOTES_FILE, MAP_FILE } = paths();
  const PROTOTYPES_FILE = path.join(OUT_DIR, "prototypes.json");
  if (!fs.existsSync(MAP_FILE)) {
    console.error("No screenmap.json yet — run `screen-map build` first.");
    process.exit(1);
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    // Save notes.
    if (req.method === "PUT" && url.pathname === "/notes") {
      readBody(req, res, 8e6, (body) => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.notes)) throw new Error("expected { notes: [...] }");
          fs.writeFileSync(NOTES_FILE, JSON.stringify(parsed, null, 2));
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(e.message) })); }
      });
      return;
    }

    // Save prototype-review decisions to .screenmap/prototypes.json.
    if (req.method === "PUT" && url.pathname === "/prototypes") {
      readBody(req, res, 8e6, (body) => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.prototypes)) throw new Error("expected { prototypes: [...] }");
          fs.writeFileSync(PROTOTYPES_FILE, JSON.stringify(parsed, null, 2));
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(e.message) })); }
      });
      return;
    }
    // Screen Map doesn't capture prototypes itself: tell any client that asks.
    if (req.method === "POST" && url.pathname === "/prototype-capture") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unsupported", captured: 0, total: 0 }));
      return;
    }

    // Refresh (recapture) a set of screens — the review-pipeline "see the new version" step.
    if (req.method === "POST" && url.pathname === "/recapture") {
      readBody(req, res, 1e6, async (body) => {
        try {
          const parsed = JSON.parse(body || "{}");
          const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((x) => typeof x === "string") : [];
          if (!ids.length) throw new Error("expected { ids: [\"…\"] }");
          if (ids.length > 24) throw new Error("refresh at most 24 screens at once");
          const { recaptureIds } = await import("./build.mjs");
          const out = await recaptureIds(ids, { concurrency: 2 });
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(e.message) })); }
      });
      return;
    }

    // Route a finding to the configured output adapter (markdown/github).
    if (req.method === "POST" && url.pathname === "/route") {
      readBody(req, res, 1e6, async (body) => {
        try {
          const parsed = JSON.parse(body || "{}");
          const map = readJson(MAP_FILE, null);
          if (!map) throw new Error("no build");
          const notes = readJson(NOTES_FILE, { notes: [] }).notes || [];
          const note = parsed.note || notes.find((n) => n.id === parsed.noteId);
          if (!note) throw new Error("note not found");
          const { buildFinding } = await import("./finding.mjs");
          const { sendFinding } = await import("./output/index.mjs");
          const finding = buildFinding(note, map);
          const out = await sendFinding(finding, parsed.adapter ? { adapter: parsed.adapter } : {});
          res.writeHead(out.ok ? 200 : 400, { "content-type": "application/json" }); res.end(JSON.stringify(out));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(e.message) })); }
      });
      return;
    }

    // Lightweight change probe for the viewer's auto-refresh.
    if (req.method === "GET" && url.pathname === "/rev") {
      const mtime = (f) => { try { return Math.floor(fs.statSync(f).mtimeMs); } catch { return 0; } };
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, map: mtime(MAP_FILE), notes: mtime(NOTES_FILE), proto: mtime(PROTOTYPES_FILE) }));
      return;
    }

    // No prototypes yet: an empty list, not a 404 the browser would log on every page load.
    if (req.method === "GET" && url.pathname === "/prototypes.json" && !fs.existsSync(PROTOTYPES_FILE)) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ prototypes: [] }));
      return;
    }

    // Static.
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end("bad request"); return; }
    if (rel === "/") rel = "/index.html";
    const file = path.join(OUT_DIR, path.normalize(rel));
    if (!file.startsWith(OUT_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });

  let active = port;
  const onListen = () => {
    console.log(`\n  Screen Map → http://localhost:${active}\n  (notes save straight to .screenmap/notes.json · Ctrl-C to stop)\n`);
    if (open) {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      execFile(opener, [`http://localhost:${active}`], () => {});
    }
  };
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE" && active < port + 25) { active++; server.listen(active, onListen); return; }
    console.error(e.code === "EADDRINUSE" ? `\nNo free port found near ${port}.\n` : `server error: ${e.message}`);
    process.exit(1);
  });
  server.listen(active, onListen);
  return server;
}
