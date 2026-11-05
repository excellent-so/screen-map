// Screen Map — VS Code / Open VSX extension: a THIN HOST over the CLI.
//
// The extension host is full Node, so the engine runs unchanged — we just spawn the
// `screen-map` CLI in an integrated terminal (live output, reuses the user's install)
// and render the existing self-contained viewer inside VS Code's Simple Browser. Not
// a fork: terminal / CI / other-editor users stay first-class. Published to BOTH the
// MS Marketplace AND Open VSX — Cursor / Windsurf / VSCodium pull only
// from Open VSX.

const vscode = require("vscode");

function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : undefined;
}

function cfg() {
  const c = vscode.workspace.getConfiguration("screenMap");
  return { command: c.get("command", "npx --yes @excellent-so/screen-map"), port: c.get("port", 4699) };
}

/** Run a screen-map subcommand in a reused integrated terminal. */
function runInTerminal(name, args, cwd) {
  const existing = vscode.window.terminals.find((t) => t.name === name);
  const term = existing || vscode.window.createTerminal({ name, cwd });
  term.show(true);
  const { command } = cfg();
  term.sendText(`${command} ${args}`);
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

function activate(context) {
  const root = () => {
    const r = workspaceRoot();
    if (!r) vscode.window.showErrorMessage("Screen Map: open a folder first.");
    return r;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("screenMap.build", () => {
      const r = root(); if (!r) return;
      runInTerminal("Screen Map", "build", r);
    }),

    vscode.commands.registerCommand("screenMap.serve", async () => {
      const r = root(); if (!r) return;
      const { port } = cfg();
      runInTerminal("Screen Map — serve", `serve --port=${port}`, r);
      // Give the server a moment to bind before pointing the browser at it.
      await new Promise((res) => setTimeout(res, 1800));
      await openViewer(port);
    }),

    vscode.commands.registerCommand("screenMap.open", async () => {
      const r = root(); if (!r) return;
      const { port } = cfg();
      // Build, then serve + open. The serve terminal is separate so build output is
      // readable and the server keeps running after the build exits.
      runInTerminal("Screen Map", "build", r);
      runInTerminal("Screen Map — serve", `serve --port=${port}`, r);
      await new Promise((res) => setTimeout(res, 2500));
      await openViewer(port);
    }),

    vscode.commands.registerCommand("screenMap.doctor", () => {
      const r = root(); if (!r) return;
      runInTerminal("Screen Map", "doctor", r);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
