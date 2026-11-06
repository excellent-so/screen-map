# Contributing

MIT project — by contributing you agree your changes are offered under the same MIT
license (inbound = outbound; no CLA required).

## What's welcome

- Bug fixes
- Documentation improvements
- New framework discovery adapters (Next.js Pages Router, Remix, SvelteKit, etc.)
- Small, focused improvements with a clear use case

For larger features or changes to core architecture, open an issue first so we can
discuss the direction before you invest time in a PR.

## Getting the code

```sh
git clone https://github.com/excellent-so/screen-map.git
cd screen-map
```

There is nothing to install: Screen Map has no runtime dependencies.

## Before submitting

Run the test suite and confirm it passes:

```sh
npm test                  # no Chrome needed
npm run test:standalone   # builds a real map with your Chrome, in a bare environment
```

Expected: `screen-map tests: N passed, 0 failed`, then `screen-map standalone: passed`. CI runs `npm test` on
Node 20 and 22. If you change the viewer's CSS, run `npm run styleguide` too.

Keep PRs focused — one logical change per PR makes review faster.
