# Screen Map for VS Code

The map of your running app, in your editor. A thin host over the
[Screen Map](https://github.com/excellent-so/screen-map) CLI
(`@excellent-so/screen-map`): it screenshots every route of your Next.js App Router
app, graphs how they connect, and renders the browsable map inside VS Code.

Existing Next route extensions show a **static filesystem tree** — no dev server, no
screenshots. Screen Map renders the real, running app.

## Commands

- **Screen Map: Build & Open Viewer** — build the map, then serve it and open it in the editor once it's up.
- **Screen Map: Build** — (re)build the map.
- **Screen Map: Open Viewer (no rebuild)** — serve the last build and open it.
- **Screen Map: Doctor** — report config / Chrome / adapter status.

## Requirements

- Your dev server running (e.g. `next dev`).
- Node ≥ 20 and a system Chrome/Chromium (the CLI finds it, or fetches one on demand).

## Settings

- `screenMap.command` — how to invoke the CLI (default `npx --yes @excellent-so/screen-map`).
  Install `@excellent-so/screen-map` as a devDependency and set this to `screen-map` for
  a faster inner loop.
- `screenMap.port` — the local viewer port (default `4699`).

## Publishing (maintainers)

Published to **both** registries so Cursor / Windsurf / VSCodium (Open VSX) and
VS Code (Marketplace) can install it:

```sh
cd extension
npx @vscode/vsce package --no-dependencies   # → screen-map-vscode-<version>.vsix
npm install                                  # once, for the publish tools
npm run publish:vscode                       # vsce publish → MS Marketplace
npm run publish:openvsx                      # ovsx publish → Open VSX
```

## Source and issues

The code, and the place to report a bug, is
[github.com/excellent-so/screen-map](https://github.com/excellent-so/screen-map)
(this extension lives in its `extension/` folder).

MIT © Excellent
