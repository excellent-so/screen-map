// Screen Map: the starter config `screen-map init` writes, filled with what it detected.

import { HOMEPAGE } from "./meta.mjs";

/** The text of a screen-map.config.mjs for this project (`detected` is the resolved config). */
export function scaffoldConfig(detected) {
  return `// screen-map.config.mjs. Every option: ${HOMEPAGE}#configuration
export default {
  // App Router directory (auto-detected as "${detected.appDir}" if omitted).
  appDir: ${JSON.stringify(detected.appDir)},

  // Your running dev server. SCREENMAP_BASE overrides.
  devBaseUrl: ${JSON.stringify(detected.devBaseUrl)},

  // Optional: let Screen Map run its OWN disposable dev server (with --managed-server,
  // or set autostart:true to use it every run). It's booted on an ephemeral port,
  // captured against, then torn down fully — so a long run never depends on (or wedges)
  // a server you keep running. distDirEnv relocates the build cache so two Next dev
  // servers don't share one \`.next\`; env can point the app at a throwaway data dir.
  // server: {
  //   command: "next dev",
  //   readyPath: "/",
  //   // distDirEnv: "MYAPP_DIST_DIR", distDir: ".next-screen-map",
  //   // env: { MYAPP_DATA_DIR: "/tmp/screen-map-scratch" },
  //   // autostart: true,
  // },

  // Discovery: "router-walk" (finds orphans) ∪ "crawl" (any framework).
  framework: "next-app-router",
  discovery: ["router-walk", "crawl"],

  // Screenshots of pages only the crawl finds, nearest "/" first (0 for none).
  // crawlCaptureMax: 100,

  // Section taxonomy: a (route) => group function, or a { root: group } map.
  // Default: the first path segment. Uncomment to customize.
  // groups: (route) => route.split("/")[1] || "root",

  // Optional global-nav targets (so bar-only pages aren't false orphans).
  // navBackbone: ["/", "/settings", "/help"],

  // Optional route roots where global chrome is absent (auth/takeover screens).
  // noChromeRoots: ["login", "welcome"],

  // Optional regex flagging empty/cold-start components for the "empty" state.
  // coldStartPattern: "\\\\b(EmptyState|ColdStart)\\\\b",

  // Optional declared multi-state flows (wizards, auth state machines).
  // flows: [],

  // Where findings go: "markdown" (default) | "github".
  output: { adapter: "markdown" },
};
`;
}
