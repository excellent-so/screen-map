// Copy the viewer's CSS into the styleguide, so viewer/styleguide.html always draws Screen Map's parts with
// exactly the rules viewer/index.html ships. Two blocks are copied, each between its markers:
//
//   /* excellent-kit:begin */ ... /* excellent-kit:end */   the kit (written into index.html by excellent-kit sync)
//   /* screen-map:begin ...  ... /* screen-map:end */      Screen Map's own parts
//
//   node scripts/sync-styleguide.mjs           rewrite viewer/styleguide.html
//   node scripts/sync-styleguide.mjs --check   exit 1 if it is out of date

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VIEWER = path.join(ROOT, "viewer", "index.html");
export const STYLEGUIDE = path.join(ROOT, "viewer", "styleguide.html");
export const BLOCKS = [
  ["/* excellent-kit:begin */", "/* excellent-kit:end */"],
  ["/* screen-map:begin", "/* screen-map:end */"],
];

/** The text of one marked block, markers included, or null when the markers are missing. */
export function block(html, [begin, end]) {
  const a = html.indexOf(begin), b = html.indexOf(end, a);
  return a < 0 || b < 0 ? null : html.slice(a, b + end.length);
}

/** The styleguide with every block replaced by the viewer's. Throws if a block is missing on either side. */
export function synced(viewerHtml, guideHtml) {
  let out = guideHtml;
  for (const markers of BLOCKS) {
    const src = block(viewerHtml, markers), dst = block(out, markers);
    if (src == null) throw new Error(`viewer/index.html has no ${markers[0]} block`);
    if (dst == null) throw new Error(`viewer/styleguide.html has no ${markers[0]} block`);
    out = out.replace(dst, () => src);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const viewer = fs.readFileSync(VIEWER, "utf8");
  const guide = fs.readFileSync(STYLEGUIDE, "utf8");
  const next = synced(viewer, guide);
  if (next === guide) console.log("up to date  viewer/styleguide.html");
  else if (process.argv.includes("--check")) { console.error("out of date  viewer/styleguide.html (run: npm run styleguide)"); process.exit(1); }
  else { fs.writeFileSync(STYLEGUIDE, next); console.log("synced  viewer/styleguide.html"); }
}
