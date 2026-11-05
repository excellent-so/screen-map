// Screen Map: `screen-map bug`, which files a bug in Screen Map itself as a GitHub issue.
// It builds a report from what the user typed and the machine's versions, turns it into
// an issue title and body, and makes a new-issue link on the repo in package.json's
// `bugs.url` with both filled in. Nothing is sent: the user reads the issue, opens the
// link and submits it on GitHub. Zero dependencies, no network.

import { BUGS_URL } from "./meta.mjs";

const SCHEMA = "bug-report.v1";
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 10000;
const SEVERITIES = new Set(["low", "medium", "high"]);
/** Browsers and GitHub cope with longer links, but not every terminal or proxy does. */
export const URL_MAX = 7000;
const TRIM_NOTE = "\n\n(Trimmed to fit the link.)";

/** Replace lone surrogates, so encodeURIComponent never throws on the text. */
function wellFormed(s) {
  return typeof s.toWellFormed === "function" ? s.toWellFormed() : s;
}

/** Cut to `maxLen` UTF-16 units without splitting a surrogate pair. */
function clamp(s, maxLen) {
  if (typeof s !== "string" || s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Build a report from raw input: stamps schema + created_at and clamps the title and
 *  description. Pure: never sends, never throws. */
export function buildBugReport(input = {}) {
  const report = {
    schema: SCHEMA,
    product: input.product,
    title: wellFormed(clamp(String(input.title ?? "").trim(), TITLE_MAX)),
    created_at: input.created_at || new Date().toISOString(),
  };
  if (input.product_version) report.product_version = String(input.product_version);
  if (input.description != null && input.description !== "") report.description = wellFormed(clamp(String(input.description), DESCRIPTION_MAX));
  if (input.severity) report.severity = input.severity;
  if (input.platform) report.platform = input.platform;
  if (input.context) report.context = input.context;
  return report;
}

/** Check a report's shape. Returns { ok: true } or { ok: false, error }. */
export function validateBugReport(report) {
  if (!report || report.schema !== SCHEMA) return { ok: false, error: "bad-schema" };
  if (typeof report.title !== "string" || report.title.length < 1 || report.title.length > TITLE_MAX) {
    return { ok: false, error: "bad-title" };
  }
  if (report.description != null && report.description.length > DESCRIPTION_MAX) return { ok: false, error: "description-too-long" };
  if (report.severity && !SEVERITIES.has(report.severity)) return { ok: false, error: "bad-severity" };
  return { ok: true };
}

/** The issue a report becomes: { title, body }. The body is the description, then the
 *  versions and platform, then when it was reported. */
export function bugIssue(report) {
  const p = report.platform || {};
  const facts = [
    report.severity && `Severity: ${report.severity}`,
    [report.product, report.product_version].filter(Boolean).join(" "),
    p.runtime,
    [p.os, p.arch].filter(Boolean).join(" "),
    ...Object.entries(report.context || {}).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
  ].filter(Boolean);
  const body = [
    report.description || "(No description.)",
    "",
    "---",
    "",
    ...facts.map((x) => `- ${x}`),
    "",
    `Reported with \`screen-map bug\` at ${report.created_at}.`,
  ].join("\n");
  return { title: report.title, body };
}

/**
 * The prefilled new-issue link for a report, on the repo whose issues live at `bugsUrl`.
 * When the link would pass `max` characters, the description is cut (whole characters,
 * the versions kept) until it fits. Returns { url, title, body, trimmed }: `title` and
 * `body` are exactly what the link fills in.
 */
export function bugIssueUrl(report, { bugsUrl = BUGS_URL, max = URL_MAX } = {}) {
  const base = `${String(bugsUrl).replace(/\/+$/, "")}/new`;
  const link = (title, body) => `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const { title, body } = bugIssue(report);
  if (link(title, body).length <= max) return { url: link(title, body), title, body, trimmed: false };

  const chars = Array.from(report.description || "");
  const bodyWith = (n) => bugIssue({ ...report, description: chars.slice(0, n).join("") + TRIM_NOTE }).body;
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (link(title, bodyWith(mid)).length <= max) lo = mid;
    else hi = mid - 1;
  }
  const trimmedBody = bodyWith(lo);
  return { url: link(title, trimmedBody), title, body: trimmedBody, trimmed: true };
}
