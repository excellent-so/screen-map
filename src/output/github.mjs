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

export async function send(finding, opts = {}) {
  const tok = token();
  if (!tok) {
    return { ok: false, error: "no-token", message: "Set GITHUB_TOKEN (a repo-scoped token) to open GitHub issues." };
  }
  const repo = resolveRepo(opts);
  if (!repo) {
    return { ok: false, error: "no-repo", message: "Set output.github.repo (\"owner/name\") — could not detect a GitHub origin remote." };
  }
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
    return { ok: false, error: "network", message: String((e && e.message) || e) };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `http-${res.status}`, message: detail.slice(0, 300) };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: true, ref: `#${json.number}`, url: json.html_url };
}
