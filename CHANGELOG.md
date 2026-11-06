# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.4] - 2026-11-05

### Added

- The viewer and its styleguide embed Geist and Geist Mono (`sync --fonts`), so they look the same on every
  machine, with no outside requests. The viewer file grows by about 190 KB.
- Pages the crawl reaches now get screenshots, taken the same way as the routes the walk finds, and sit on
  the board in their path's group. That covers every page of an app that isn't a Next.js App Router app, and
  the pages a Next app serves outside `app/` (a Pages Router page, a rewrite). They are never orphans. A URL
  that isn't a page (a stylesheet, a feed, an error status, a redirect to another site) stays on the map
  without a screenshot and says why. Each build takes them fresh, at most `crawlCaptureMax` of them (100 by
  default, nearest `/` first; `--crawl-capture-max=N` for one build, `0` for none), and `regraph` keeps them.

### Changed

- Screen Map has its own mark: two screens joined by a line. It sits left of the name in the viewer's header,
  is the browser tab's icon (ink, or white on a dark system theme), heads the README (`docs/mark.svg`) and is
  the editor extension's icon (`extension/icon.png`). The viewer and its styleguide no longer show another
  logo or a byline.
- `screen-map bug` sends nothing. It shows the issue it makes (your title and description, then your Screen
  Map, Node and OS versions) and prints a link that opens that issue on GitHub, filled in, for you to check
  and submit. The repo is the one in package.json's `bugs.url`. A long description is cut to keep the link
  under 7,000 characters, and the command says so. `--email` and `--yes` are no longer used.
- The viewer's kit block is `@excellent-so/kit` 0.2.1, which adds `.ex-mark`, the 16px slot for a tool's mark.
- The README, CONTRIBUTING and the editor extension link to the code on GitHub,
  [github.com/excellent-so/screen-map](https://github.com/excellent-so/screen-map).
- `npm run test:standalone` checks that the build runs with only HOME, PATH, TMPDIR and LANG set.
- Code comments say what the code does, without references to internal documents.

### Removed

- The `excellent` output adapter (`route --adapter=excellent`) and the `doctor` line that looked for it. A
  config that still names it gets one line from `screen-map route` and `screen-map doctor`: the adapter was
  removed in 0.2.4, use `markdown` or `github`.
- The bug report's request to a hosted endpoint, its web-form fallback, and the variable that set the
  endpoint.

### Fixed

- The flow graph no longer draws the crawl's own copy of every link a page's DOM or source already shows, and
  a link many pages share counts as global nav whichever of them found it, so "Show global nav links" hides
  the sidebar's links between columns.
- `screen-map recapture` and a note's "Refresh screens" read the refreshed pages' links again and recompute
  orphans and dead ends, so the Orphan and Dead end badges follow the fix. `build` and `regraph` keep the
  before/after history a recapture built up, and a shot a build reuses keeps the time it was taken.
- In the dark theme, the "in review" label on a screenshot is ink with white text, as in the light theme, so
  it reads on a light screenshot.
- With no prototypes, `screen-map serve` answers `prototypes.json` with an empty list, so loading the viewer no
  longer logs a failed request.

## [0.2.3] - 2026-11-05

### Changed

- The viewer takes the look of `@excellent-so/kit` (MIT): ink on white, light by default, dark
  when you choose it in the menu (kept under the `ex-theme` key; an earlier dark choice carries over). States
  are ink outlines with a glyph; red marks only a capture that failed. The header, board, table, flow graph,
  drawer and review pipeline are rebuilt on the kit's tokens and parts, and the viewer works on a phone.
- The flow graph tells kinds of link apart by their dash, and its labels are 12px or larger.
- The Prototype brief and the Prototypes view are generic: the brief asks your agent to list its variations in
  `.screenmap/prototypes.json`, and every command it gives is `npx @excellent-so/screen-map`.
- `viewer/styleguide.html` now shows only Screen Map's own parts, drawn with the viewer's CSS
  (`npm run styleguide` copies it), and points to the kit's styleguide for the rest.
- The README says plainly what works where: route discovery and orphan finding need a Next.js App Router
  app; other apps get the crawl only.

### Fixed

- Headless Chrome no longer asks the OS keychain for secrets, so a run with a fresh HOME (CI, a sandbox, a
  new user) no longer stalls on a keychain prompt.
- `screen-map init` and GitHub issues link to the package's real home, github.com/excellent-so/screen-map.
- The editor extension's fallback command runs `@excellent-so/screen-map`, the scoped package.
- The board's column names showed blank (a class clash with the note view).
- Removed a local file path from the bug-report client.

### Added

- `npm run test:standalone`: builds a real map of the fixture app with nothing else installed (an empty HOME,
  a bare PATH, no inherited variables), outside any repo, and fails unless every screen is captured and the
  orphan found.

## [0.2.2] - 2026-07-11

### Added

- OSS scaffolding: `SECURITY.md`, `CONTRIBUTING.md`, CI workflow, `extension/LICENSE`.

### Fixed

- Repository/homepage/bugs URLs now point at the real public home,
  [github.com/excellent-so/screen-map](https://github.com/excellent-so/screen-map)
  (previous metadata referenced a non-existent `excellentso` account).

## [0.2.1] - 2026-07-11

### Added

- **Route-URL pins** (`routeUrls` config key + a gitignored `.screenmap/route-urls.json`)
  — map a route PATTERN → a concrete URL, resolved before seed substitution and DOM
  harvest. The escape hatch for makeable dynamic routes the harvest can't reach: an
  overloaded `[id]` param (one seed value can't fit two unrelated `[id]` routes), a
  detail route with no scrapeable index, or a section-scoped route whose real index
  lives under a different section than the seed.

## [0.2.0] - 2026-07-11

### Added

- **Managed dev server** (`--managed-server` / `server` config block) — Screen Map can
  now run its OWN disposable dev server instead of depending on one you keep running.
  It boots the configured `command` on an ephemeral port, captures against it, and tears
  it down fully afterward (process-group kill wired to `stop()`/SIGINT/SIGTERM/exit).
  Options: `port`/`portBase` (auto-pick), `portFlag`, `readyPath`/`readyTimeoutMs`,
  `env` (point the app at a throwaway DB), `distDirEnv`/`distDir` (isolate the build
  cache so two Next dev servers don't share one `.next`), `prepare` (one-time setup),
  `autostart` (use it every run without the flag).
- **Health watchdog** — a wedged managed server is killed and respawned on the *same*
  port, so the capture URL never changes; a long/overnight run survives a mid-run hang
  instead of failing every remaining shot.
- **Retry pass** for failed shots (`--retry-failed`; implied by `--managed-server`) —
  re-runs just the failed `(screen, state)` captures once, recovering transient
  cold-compile / hiccup failures.

## [0.1.1] - 2026-07-09

### Added

- **State-sweep** — auto-discovers hidden state screens from source without per-route
  declaration; infers value domains from string-union types, `as const` allow-lists,
  and indexed arrays and fans each route into one screen per state.
- `stateSweep` config key (boolean or `{enabled, maxPerRoute, maxTotal}`); `statePreview`
  escape hatch for gated states that need a query param to render.
- `screen-map regraph` command — fast, Chrome-free rebuild reusing existing screenshots.

## [0.1.0] - 2026-07-09

### Added

- **Route walk** — enumerates every route from the Next.js App Router filesystem,
  including orphan pages nothing links to.
- **Screenshot capture** — drives a headless system Chrome/Chromium/Edge/Brave to
  capture each route; `--download-chrome` fetches one on demand.
- **Navigation graph** — builds a graph from `<Link>` / `router.push` / `redirect`
  source analysis, validates it against a live crawl, and surfaces orphans and dead-ends.
- **Local viewer** — self-contained screen board, flow graph, multi-select notes,
  before/after diffing, and a note → agent → refresh review loop.
- **Findings routing** — `screen-map route` exports notes to markdown, a GitHub issue,
  or a task in Excellent (removed in 0.2.4).
- VS Code / Open VSX extension — thin host that runs the CLI and renders the viewer
  inside the editor (Cursor, Windsurf, VSCodium compatible).
- Zero runtime dependencies; zero config on a standard Next.js App Router app.
