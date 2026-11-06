// Screen Map — the extension's plain helpers, with no `vscode` import so the CLI's test suite can
// run them: the shell line that builds then serves, and the wait for the viewer to answer.

const http = require("node:http");

/** `a`, then `b` only if `a` succeeded, in the syntax of the terminal's shell (`shell` is its path). */
function chain(shell, a, b) {
  const name = String(shell || "").split(/[\\/]/).pop().toLowerCase();
  // Windows PowerShell 5 has no `&&`; PowerShell 7 (pwsh), cmd and the POSIX shells do.
  if (name === "powershell.exe" || name === "powershell") return `${a}; if ($?) { ${b} }`;
  return `${a} && ${b}`;
}

/** True once http://localhost:<port>/rev answers as a Screen Map viewer does. */
function viewerAnswers(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: "localhost", port, path: "/rev", timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => { try { resolve(res.statusCode === 200 && JSON.parse(body).ok === true); } catch { resolve(false); } });
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

/**
 * Poll the viewer's port until it answers, `stop()` says to give up, or `timeoutMs` passes.
 * Resolves true when the viewer is up.
 */
async function waitForViewer(port, { timeoutMs = 15 * 60 * 1000, everyMs = 1000, stop = () => false } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !stop()) {
    if (await viewerAnswers(port)) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

module.exports = { chain, viewerAnswers, waitForViewer };
