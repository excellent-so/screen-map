// Screen Map — finding: the portable unit a review note becomes when it leaves the
// tool. A note points at exact screens and survives until fixed; a
// finding is that note enriched with the routes / live URLs / shots / graph signals
// an issue-tracker or task system needs.

import { devBaseUrl } from "./env.mjs";

/**
 * Build a portable Finding from a stored review note + the current map.
 *
 * @param {object} note  { id, screens:[ids], direction, intent, body }
 * @param {object} map   the screenmap.json artifact
 * @returns {object} Finding: { id, routes, urls, shots, signals, direction, intent, body, … }
 */
export function buildFinding(note, map) {
  const byId = new Map((map.screens || []).map((s) => [s.id, s]));
  const orphans = new Set(map.orphans || []);
  const deadEnds = new Set(map.deadEnds || []);
  const proven = new Set(map.provenOrphans || []);
  const base = devBaseUrl();

  const ids = Array.isArray(note.screens) ? note.screens : [];
  const routes = [], urls = [], shots = [];
  let anyOrphan = false, anyDeadEnd = false, anyProven = false;
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    routes.push(s.route);
    if (s.url) urls.push(base + s.url);
    const shot = (s.states || []).find((st) => st.ok && st.shot);
    if (shot) shots.push(`.screenmap/${shot.shot}`);
    if (orphans.has(id)) anyOrphan = true;
    if (deadEnds.has(id)) anyDeadEnd = true;
    if (proven.has(id)) anyProven = true;
  }

  return {
    id: note.id && note.id.startsWith("f_") ? note.id : `f_${(note.id || "").replace(/^n_/, "") || Math.random().toString(36).slice(2, 9)}`,
    screens: ids,
    routes,
    urls,
    direction: note.direction || "issue",
    intent: note.intent || "fix",
    body: note.body || note.text || "",
    shots,
    signals: { orphan: anyOrphan, deadEnd: anyDeadEnd, provenOrphan: anyProven },
  };
}

/** A concise, human/agent-readable rendering of a finding (title + body). */
export function findingTitle(finding) {
  const where = finding.routes.length ? finding.routes.join(", ") : "screen";
  const first = (finding.body || "").split("\n")[0].slice(0, 80);
  return `[screen-map] ${where} — ${first || "UX finding"}`;
}

export function findingMarkdown(finding) {
  const lines = [];
  lines.push(`### ${findingTitle(finding)}`);
  lines.push("");
  lines.push(finding.body || "");
  lines.push("");
  if (finding.routes.length) lines.push(`- **Routes:** ${finding.routes.map((r) => `\`${r}\``).join(", ")}`);
  if (finding.urls.length) lines.push(`- **URLs:** ${finding.urls.map((u) => `[${u}](${u})`).join(", ")}`);
  const sig = finding.signals || {};
  const tags = [sig.orphan && "orphan", sig.deadEnd && "dead-end", sig.provenOrphan && "proven-orphan"].filter(Boolean);
  if (tags.length) lines.push(`- **Signals:** ${tags.join(", ")}`);
  lines.push(`- **Intent:** ${finding.intent} · **Direction:** ${finding.direction}`);
  if (finding.shots.length) lines.push(`- **Shots:** ${finding.shots.map((s) => `\`${s}\``).join(", ")}`);
  lines.push("");
  return lines.join("\n");
}
