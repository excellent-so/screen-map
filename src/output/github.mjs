// Screen Map — output adapter: GitHub issue (the universal, credential-light path).
//
// POSTs an issue via the REST API. The token comes from the environment (GITHUB_TOKEN /
// GH_TOKEN), never from config or the map, and it is the only credential Screen Map
// reads. Repo is `config.output.github.repo` ("owner/name")
// or auto-detected from the `origin` git remote. Zero-dep (global fetch).

import { execFileSync } from "node:child_process";
import { findingTitle, findingMarkdown } from "../finding.mjs";
import { HOMEPAGE } from "../meta.mjs";

export const name = "github";

function token() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

/** owner/name from config, else parse the git origin remote. */
export function resolveRepo(opts = {}) {
  if (opts.repo) return opts.repo;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/i);
    if (m) return `${m[1]}/${m[2]}`;
  } catch { /* not a git repo / no origin */ }
  return null;
}

/** The issue's body: the finding, then a credit line linking to Screen Map's home. */
export function issueBody(finding) {
  return findingMarkdown(finding) + `\n\n<sub>opened by [screen-map](${HOMEPAGE})</sub>`;
}

const NO_TOKEN = "Opening GitHub issues needs a token: set GITHUB_TOKEN (or GH_TOKEN) to a token that can write issues on the repo.";
const NO_REPO = "Screen Map can't tell which GitHub repo to open issues on: set output.github.repo (\"owner/name\") in screen-map.config.*, or run it in a clone whose origin remote is on GitHub.";

/** Why this adapter can't send yet, or null when it can. */
export function notReady(opts = {}) {
  if (!token()) return NO_TOKEN;
  if (!resolveRepo(opts)) return NO_REPO;
  return null;
}

export async function send(finding, opts = {}) {
  const tok = token();
  if (!tok) return { ok: false, error: "no-token", message: NO_TOKEN };
  const repo = resolveRepo(opts);
  if (!repo) return { ok: false, error: "no-repo", message: NO_REPO };
  const labels = Array.isArray(opts.labels) ? opts.labels : ["screen-map", finding.intent === "fix" ? "ux" : "prototype"];
  const body = issueBody(finding);
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${tok}`,
        "accept": "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "screen-map",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ title: findingTitle(finding), body, labels }),
    });
  } catch (e) {
    return { ok: false, error: "network", message: `Couldn't reach api.github.com (${String((e && e.message) || e)}).` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let why = detail.slice(0, 300);
    try { why = JSON.parse(detail).message || why; } catch { /* not JSON */ }
    return { ok: false, error: `http-${res.status}`, message: `GitHub answered ${res.status} for ${repo}${why ? `: ${why}` : ""}.` };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: true, ref: `#${json.number}`, url: json.html_url };
}
