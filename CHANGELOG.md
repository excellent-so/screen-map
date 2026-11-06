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
- Screenshots are taken in the light theme, whatever the OS uses (`colorScheme: "dark"` in the config for
  dark). Headless Chrome followed the system theme, so a Mac in dark mode captured dark screens, and one that
  turned dark at sunset showed every screen as changed on the next recapture.
- The address given to a build (`--base` or `SCREENMAP_BASE`) carries over to the commands after it: the
  viewer's Refresh, `recapture`, `regraph` and the next build. A dev server on another port needs `--base`
  once. `--base` also takes `localhost:3001` (no `http://`) and a trailing slash.
- `route` sends only the notes still queued. A note an agent already has stays with the agent, and an
  approved note stays approved (`route` used to send them again and move them to With agent). `--all` sends
  every note.
- `screen-map --version` prints the version, and `screen-map help` lists the flags every command takes
  (`--base`, `--chrome`, `--app-dir`, `--discovery`, `--framework`, `--output`).
- `doctor` checks that the dev server answers, and flags an unknown framework and a GitHub output with no
  token or repo.
- The npm package leaves out `viewer/styleguide.html` (a page for contributors) and includes this changelog:
  about 260 KB packed, down from 414 KB.
- CI runs the tests on Node 20, the lowest version `engines` allows, and on Node 22.
- The README covers Chrome and `--download-chrome`, the files Screen Map writes, what it sends, how
  `route` picks notes and the GitHub repo, and how to uninstall.

### Removed

- The `excellent` output adapter (`route --adapter=excellent`) and the `doctor` line that looked for it. A
  config that still names it gets one line from `screen-map route` and `screen-map doctor`: the adapter was
  removed in 0.2.4, use `markdown` or `github`.
- The bug report's request to a hosted endpoint, its web-form fallback, and the variable that set the
  endpoint.

### Fixed

- A plain static site maps every page. The crawl follows relative links (`about.html`, `../`, `./team`) and
  absolute links to the same site, takes a redirect within the app (`about.html` → `/about` on a server with
  clean URLs) as the page it lands on rather than a second screen, and loads a folder at the URL it was
  linked by (`/blog/`), so the folder's relative links resolve as they do in a browser. A site that linked
  with relative hrefs used to map as `/` alone.
- A `<link>` in a page's head (a stylesheet, an icon, a preloaded image) is no longer read as a link to a
  screen, so a fresh `create-next-app` no longer puts `/next.svg` on the board as a dead end. A URL that
  isn't a page is never a dead end.
- A build against a dev server that isn't running stops before it starts, with one sentence that says what to
  do. It used to write a map of failed shots in which every route was a "proven orphan". A crawl that loads
  no page now proves no orphans, and when no screenshot works (a browser that can't run) the build says what
  to check and exits 1. When some fail, it lists them.
- `screen-map <command> --help` prints the help: `build --help` used to run a build. An unknown command
  exits 1 and says so, where it printed the help and exited 0.
- Mistakes get one sentence and exit 1, with no stack trace: a config file that doesn't load (named, with
  the reason), an unknown `framework`, a `--port` or `--server-port` that isn't a number, `regraph` or
  `recapture` before any build (`regraph` wrote an empty map and exited 0), `recapture` with ids that aren't
  in the map, and `--download-chrome` without `@puppeteer/browsers`, which now gives the commands that work
  with npx and in a project. An unexpected error prints its message, and its stack with `SCREENMAP_DEBUG=1`.
- `route --adapter=github` checks the token and the repo once, before it sends anything, rather than failing
  note by note and exiting 0. `route` exits 1 when a finding isn't sent, and GitHub's errors read as
  sentences.
- `screen-map bug` reads a title and description piped in on two lines, and with nothing on stdin it exits 1
  and asks for a title. It used to print both prompts and stop, exit 0.
- `open` on a busy port opens the browser once, on the free port it found; it opened a tab, and printed the
  URL, once per busy port. On Windows, `open` now opens the browser.
- `--managed-server` finds the project's own `next` in `node_modules/.bin`, however Screen Map was started
  (a global install crashed on `spawn next ENOENT`). A server command that isn't installed, stops early or
  never answers gets one sentence, and Ctrl-C during its first boot stops it.
- The state sweep reads a query param declared with a string-union type
  (`searchParams: Promise<{ tab?: Tab }>`) and screenshots each value.
- Viewer: the header menus open above the review drawer, where in the Review view they were hidden under it.
  On a phone the Review view shows the pipeline (the drawer covered it), and at 1440px the pipeline's four
  columns fit beside the drawer. The activity list says "No open notes" rather than "No notes yet" when its
  filter hides them. A Refresh that captures nothing (the dev server is down) says so and leaves the note
  where it was.
- The editor extension's "Build & Open Viewer" starts the viewer after the build finishes, in one terminal,
  and opens it when it answers. It used to start both at once and open the viewer after 2.5 seconds, before a
  first build existed. "Open Viewer" waits the same way, and stops a viewer it started earlier.
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
