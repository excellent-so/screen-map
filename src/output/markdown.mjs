// Screen Map — output adapter: markdown (default, needs nothing).
//
// Appends the finding to a findings markdown file under .screenmap/ and echoes the
// same brief to stdout (what the viewer's "Copy for agent" copies). Works for
// everyone: no credentials, no network.

import fs from "node:fs";
import path from "node:path";
import { paths } from "../env.mjs";
import { findingMarkdown } from "../finding.mjs";

export const name = "markdown";

export async function send(finding, opts = {}) {
  const { OUT_DIR } = paths();
  const file = opts.file ? path.resolve(opts.file) : path.join(OUT_DIR, "findings.md");
  const md = findingMarkdown(finding);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = fs.existsSync(file) ? "" : "# Screen Map — findings\n\n";
  fs.appendFileSync(file, header + md + "\n---\n\n");
  if (!opts.quiet) process.stdout.write("\n" + md + "\n");
  return { ok: true, ref: path.relative(process.cwd(), file), url: null };
}
