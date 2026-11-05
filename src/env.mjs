// Screen Map — env: the resolved runtime context (config + paths + chrome), held
// as a single initialized-once singleton so the rest of the engine can stay in the
// original tool's ergonomic module-global style while being fully config-driven.
//
// Nothing is hardcoded: every path resolves from the HOST app's root (where the user
// ran the CLI, or where `screen-map.config.*` was found). See config.mjs.

import path from "node:path";

let ENV = null;

/**
 * Build the runtime context and install it as the singleton. Call once at startup
 * (CLI) or per-test. Returns the context.
 *
 * @param {object}  o
 * @param {string}  o.root     host app root (dir containing the config, or cwd)
 * @param {object}  o.config   resolved config (see config.mjs)
 * @param {object} [o.chrome]  { path, has } — resolved lazily by chrome.mjs if omitted
 */
export function initEnv({ root, config, chrome }) {
  const OUT_DIR = path.join(root, ".screenmap");
  const SHOTS_DIR = path.join(OUT_DIR, "shots");
  ENV = {
    root,
    config,
    chrome: chrome || null,
    paths: {
      OUT_DIR,
      SHOTS_DIR,
      // Prior captures of a screen are archived here so the viewer can flip
      // before⇄after and show a per-screen change timeline.
      HISTORY_DIR: path.join(SHOTS_DIR, "history"),
      BUILDS_DIR: path.join(OUT_DIR, "builds"),
      NOTES_FILE: path.join(OUT_DIR, "notes.json"),
      MAP_FILE: path.join(OUT_DIR, "screenmap.json"),
      LINKS_FILE: path.join(OUT_DIR, "links.json"),
      FINDINGS_FILE: path.join(OUT_DIR, "findings.json"),
      SAMPLE_PARAMS_FILE: path.join(OUT_DIR, "sample-params.json"),
      ROUTE_URLS_FILE: path.join(OUT_DIR, "route-urls.json"),
    },
  };
  return ENV;
}

/** The current runtime context. Throws if the engine is used before initEnv(). */
export function env() {
  if (!ENV) throw new Error("Screen Map: runtime not initialized — call initEnv() first.");
  return ENV;
}

/** Convenience accessors. */
export const cfg = () => env().config;
export const paths = () => env().paths;
export const appDirAbs = () => path.join(env().root, env().config.appDir);
export const devBaseUrl = () => env().config.devBaseUrl;
