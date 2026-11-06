// Screen Map — output: the output-adapter registry.
//
//   markdown   (default)  append the finding to .screenmap/findings.md and print it
//   github                open a GitHub issue through the REST API (needs GITHUB_TOKEN)
//
// A finding leaves the tool and becomes tracked work.

import { cfg } from "../env.mjs";
import * as markdown from "./markdown.mjs";
import * as github from "./github.mjs";

const ADAPTERS = { markdown, github };

// Adapters an older release had, and the version that removed each one.
const REMOVED = { excellent: "0.2.4" };

export function getOutputAdapter(name) {
  return Object.hasOwn(ADAPTERS, name) ? ADAPTERS[name] : null;
}

export function listOutputAdapters() {
  return Object.keys(ADAPTERS);
}

/** The one-line reason `name` can't be used, or null when it is a known adapter. */
export function adapterProblem(name) {
  if (getOutputAdapter(name)) return null;
  const known = listOutputAdapters().map((a) => `"${a}"`).join(" or ");
  if (Object.hasOwn(REMOVED, name)) {
    return `The "${name}" output adapter was removed in ${REMOVED[name]}. Set output.adapter to ${known}.`;
  }
  return `Unknown output adapter "${name}". Use ${known}.`;
}

/**
 * The one-line reason the adapter `name` can't send yet (a missing token, no repo to open issues
 * on), or null when it is ready. Checked once before routing, rather than failing note by note.
 */
export function adapterNotReady(name) {
  const adapter = getOutputAdapter(name);
  if (!adapter || typeof adapter.notReady !== "function") return null;
  const outCfg = cfg().output || {};
  return adapter.notReady(typeof outCfg[name] === "object" ? outCfg[name] : {});
}

/** The adapter a send will use: the named one, else config.output.adapter, else markdown. */
export function chosenAdapter(opts = {}) {
  const outCfg = cfg().output || {};
  return opts.adapter || outCfg.adapter || "markdown";
}

/**
 * Route a finding to the configured (or named) output adapter.
 * @param {object} finding
 * @param {object} [opts]  { adapter?, ...adapter-specific } — overrides config.output
 */
export async function sendFinding(finding, opts = {}) {
  const outCfg = cfg().output || { adapter: "markdown" };
  const adapterName = chosenAdapter(opts);
  const problem = adapterProblem(adapterName);
  if (problem) return { ok: false, error: Object.hasOwn(REMOVED, adapterName) ? "removed-adapter" : "unknown-adapter", message: problem };
  // Merge adapter-specific config (e.g. output.github.repo) under the adapter name.
  const adapterCfg = (outCfg && typeof outCfg[adapterName] === "object") ? outCfg[adapterName] : {};
  return getOutputAdapter(adapterName).send(finding, { ...adapterCfg, ...opts, adapter: undefined });
}
