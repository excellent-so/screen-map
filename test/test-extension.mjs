// The editor extension: its commands run the scoped package, "Build & Open" serves only after the
// build, and the viewer opens once it answers rather than after a fixed delay.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ok, eq } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const require = createRequire(import.meta.url);

export async function run() {
  const pkg = JSON.parse(fs.readFileSync(path.join(EXT, "package.json"), "utf8"));
  const src = fs.readFileSync(path.join(EXT, "src", "extension.js"), "utf8");
  const scoped = "npx --yes @excellent-so/screen-map";
  eq(pkg.contributes.configuration.properties["screenMap.command"].default, scoped, "the extension's command setting defaults to the scoped package");
  ok(src.includes(`const DEFAULT_COMMAND = "${scoped}"`), "the extension's code falls back to the same scoped command");
  ok(fs.existsSync(path.join(EXT, pkg.main)), "the extension's main file exists");
  for (const c of pkg.contributes.commands) ok(src.includes(`registerCommand("${c.command}"`), `the extension registers ${c.command}`);
  ok(fs.existsSync(path.join(EXT, pkg.icon)) && fs.existsSync(path.join(EXT, "LICENSE")), "the extension ships its icon and LICENSE");

  const { chain, viewerAnswers, waitForViewer } = require(path.join(EXT, "src", "commands.js"));
  eq(chain("/bin/zsh", "a build", "a serve"), "a build && a serve", "zsh: build && serve");
  eq(chain("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "a build", "a serve"), "a build && a serve", "pwsh 7: build && serve");
  eq(chain("C:\\Windows\\System32\\cmd.exe", "a build", "a serve"), "a build && a serve", "cmd: build && serve");
  eq(chain("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "a build", "a serve"), "a build; if ($?) { a serve }", "Windows PowerShell 5: serve only if the build succeeded");
  eq(chain(undefined, "a", "b"), "a && b", "no shell known: &&");

  // A stand-in viewer that starts answering after a moment, like `serve` after a build.
  const server = http.createServer((req, res) => {
    if (req.url === "/rev") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"map":1}'); }
    else { res.writeHead(404); res.end(); }
  });
  const port = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  ok(!(await viewerAnswers(port)), "nothing on the port: the viewer isn't up");
  setTimeout(() => server.listen(port), 600);
  const t0 = Date.now();
  ok(await waitForViewer(port, { timeoutMs: 10000, everyMs: 200 }), "waitForViewer resolves once the viewer answers");
  ok(Date.now() - t0 >= 500, "waitForViewer waited for the server rather than opening at once");
  await new Promise((r) => server.close(r));
  ok(!(await waitForViewer(port, { timeoutMs: 600, everyMs: 200 })), "waitForViewer gives up after its timeout");
  let n = 0;
  ok(!(await waitForViewer(port, { timeoutMs: 10000, everyMs: 100, stop: () => ++n > 2 })), "waitForViewer stops when told (the terminal closed, or the user cancelled)");
}
