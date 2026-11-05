// Screen Map: facts about this package, read once from its own package.json, so the
// links the tool writes (a scaffolded config, an opened issue, a bug report) match its
// published home.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pkg = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")); } catch { return {}; }
})();

export const NAME = pkg.name || "@excellent-so/screen-map";
export const VERSION = pkg.version || "0.0.0";
export const HOMEPAGE = pkg.homepage || "https://github.com/excellent-so/screen-map";
export const BUGS_URL = (typeof pkg.bugs === "string" ? pkg.bugs : pkg.bugs && pkg.bugs.url) || `${HOMEPAGE}/issues`;
