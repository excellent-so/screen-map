// Screen Map — test helpers: a tiny assert harness + fixture setup.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { initEnv } from "../src/env.mjs";

export const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixture");

let passed = 0, failed = 0;
const failures = [];

export function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}

export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(a === e, `${msg} — expected ${e}, got ${a}`);
}

export function includes(arr, val, msg) {
  ok(Array.isArray(arr) && arr.includes(val), `${msg} — ${JSON.stringify(arr)} should include ${JSON.stringify(val)}`);
}

export function excludes(arr, val, msg) {
  ok(Array.isArray(arr) && !arr.includes(val), `${msg} — ${JSON.stringify(arr)} should NOT include ${JSON.stringify(val)}`);
}

export function report(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  return { passed, failed, failures };
}

/** Load the fixture config and install the runtime env (no Chrome). */
export async function setupFixture(overrides = {}) {
  const { config, root } = await loadConfig({ cwd: FIXTURE_DIR, overrides });
  return initEnv({ root, config, chrome: { path: null, has: false, source: null } });
}

/** Install the env from an explicit config object (for degradation tests). */
export async function setupWith(configOverrides = {}) {
  const { config, root } = await loadConfig({ cwd: FIXTURE_DIR, overrides: configOverrides });
  return initEnv({ root, config, chrome: { path: null, has: false, source: null } });
}
