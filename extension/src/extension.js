// Screen Map — VS Code / Open VSX extension: a THIN HOST over the CLI.
//
// The extension host is full Node, so the engine runs unchanged — we just spawn the
// `screen-map` CLI in an integrated terminal (live output, reuses the user's install)
// and render the existing self-contained viewer inside VS Code's Simple Browser. Not
// a fork: terminal / CI / other-editor users stay first-class. Published to BOTH the
// MS Marketplace AND Open VSX — Cursor / Windsurf / VSCodium pull only
// from Open VSX.

const vscode = require("vscode");
const { chain, waitForViewer } = require("./commands");

const DEFAULT_COMMAND = "npx --yes @excellent-so/screen-map";
const BUILD_TERMINAL = "Screen Map";
const SERVE_TERMINAL = "Screen Map — viewer";

function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : undefined;
}

function cfg() {
  const c = vscode.workspace.getConfiguration("screenMap");
  return { command: c.get("command", DEFAULT_COMMAND), port: c.get("port", 4699) };
}

/** Run a line in a reused integrated terminal. */
function runInTerminal(name, line, cwd) {
  const existing = vscode.window.terminals.find((t) => t.name === name);
  const term = existing || vscode.window.createTerminal({ name, cwd });
  term.show(true);
  term.sendText(line);
  return term;
}

/** A fresh terminal for the viewer: closing the old one stops a viewer it was still serving. */
function freshTerminal(name, cwd) {
  for (const t of vscode.window.terminals) if (t.name === name) t.dispose();
  const term = vscode.window.createTerminal({ name, cwd });
  term.show(true);
  return term;
}

/** Open the served viewer inside VS Code (Simple Browser), falling back to external. */
async function openViewer(port) {
  const url = `http://localhost:${port}`;
  try {
    await vscode.commands.executeCommand("simpleBrowser.show", url);
  } catch {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

/**
 * Send `line` (which ends by serving the viewer on `port`) to a fresh viewer terminal, and open
 * the viewer once it answers. A build can take minutes, so this waits for the server rather than
 * a fixed delay, and says so if the viewer never comes up.
 */
async function serveThenOpen(r, line, port, title, timeoutMs) {
  const term = freshTerminal(SERVE_TERMINAL, r);
  let closed = false;
  const sub = vscode.window.onDidCloseTerminal((t) => { if (t === term) closed = true; });
  term.sendText(line);
  try {
    const up = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (_p, cancel) => waitForViewer(port, { timeoutMs, stop: () => closed || cancel.isCancellationRequested }),
    );
    if (up) await openViewer(port);
    else if (!closed) vscode.window.showWarningMessage(`Screen Map: the viewer isn't answering on port ${port}. The "${SERVE_TERMINAL}" terminal says why.`);
  } finally {
    sub.dispose();
  }
}

function activate(context) {
  const root = () => {
    const r = workspaceRoot();
    if (!r) vscode.window.showErrorMessage("Screen Map: open a folder first.");
    return r;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("screenMap.build", () => {
      const r = root(); if (!r) return;
      runInTerminal(BUILD_TERMINAL, `${cfg().command} build`, r);
    }),

    vscode.commands.registerCommand("screenMap.serve", async () => {
      const r = root(); if (!r) return;
      const { command, port } = cfg();
      await serveThenOpen(r, `${command} serve --port=${port}`, port, "Screen Map: starting the viewer…", 2 * 60 * 1000);
    }),

    vscode.commands.registerCommand("screenMap.open", async () => {
      const r = root(); if (!r) return;
      const { command, port } = cfg();
      // Build, then serve, in one terminal: the viewer starts only once the map exists, and
      // opens when it answers.
      const line = chain(vscode.env.shell, `${command} build`, `${command} serve --port=${port}`);
      await serveThenOpen(r, line, port, "Screen Map: building the map. The viewer opens when it's ready.", 30 * 60 * 1000);
    }),

    vscode.commands.registerCommand("screenMap.doctor", () => {
      const r = root(); if (!r) return;
      runInTerminal(BUILD_TERMINAL, `${cfg().command} doctor`, r);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
