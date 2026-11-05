// Config: zero-config defaults, auto-detect, and shape normalization.
import { loadConfig } from "../src/config.mjs";
import { cfg } from "../src/env.mjs";
import { setupFixture, FIXTURE_DIR, ok, eq } from "./helpers.mjs";

export async function run() {
  await setupFixture();
  eq(cfg().appDir, "app", "appDir auto-detected as app/");
  eq(cfg().devBaseUrl, "http://localhost:3100", "devBaseUrl comes from fixture config");
  eq(cfg().framework, "next-app-router", "framework defaults to next-app-router");
  eq(cfg().discovery, ["router-walk", "crawl"], "discovery defaults to walk ∪ crawl");
  eq(cfg().output.adapter, "markdown", "output adapter defaults to markdown");
  ok(Array.isArray(cfg().navBackbone) && cfg().navBackbone.length === 0, "navBackbone empty by default");
  ok(Array.isArray(cfg().flows) && cfg().flows.length === 0, "flows empty by default");
  ok(cfg().coldStartPattern === null, "coldStartPattern null by default");

  // Default groups: first path segment.
  eq(cfg().groupsFn("/dashboard/x"), "dashboard", "default groups = first path segment");
  eq(cfg().groupsFn("/"), "root", "default groups of / = root");

  // Groups as a { root: group } map.
  const mapped = await loadConfig({ cwd: FIXTURE_DIR, overrides: { groups: { dashboard: "work", reports: "analytics" } } });
  eq(mapped.config.groupsFn("/dashboard/x"), "work", "map groups: dashboard → work");
  eq(mapped.config.groupsFn("/reports"), "analytics", "map groups: reports → analytics");
  eq(mapped.config.groupsFn("/unknown"), "unknown", "map groups: fallback to segment");

  // Groups as a function.
  const fn = await loadConfig({ cwd: FIXTURE_DIR, overrides: { groups: (r) => (r.startsWith("/settings") ? "admin" : "app") } });
  eq(fn.config.groupsFn("/settings/x"), "admin", "function groups honored");

  // coldStartPattern string → RegExp.
  const cold = await loadConfig({ cwd: FIXTURE_DIR, overrides: { coldStartPattern: "\\bEmptyState\\b" } });
  ok(cold.config.coldStartPattern instanceof RegExp && cold.config.coldStartPattern.test("<EmptyState/>"), "coldStartPattern string coerced to RegExp");

  // navBackbone string entries → { to, label }.
  const nb = await loadConfig({ cwd: FIXTURE_DIR, overrides: { navBackbone: ["/settings", { to: "/help", label: "help" }] } });
  eq(nb.config.navBackbone[0], { to: "/settings", label: "/settings" }, "navBackbone string coerced to {to,label}");
  eq(nb.config.navBackbone[1], { to: "/help", label: "help" }, "navBackbone object preserved");
}
