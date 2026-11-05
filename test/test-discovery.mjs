// Discovery (router-walk): enumeration honors App Router rules; static edges derive.
import { enumerate, deriveStaticEdges } from "../src/discovery/next-app-router.mjs";
import { setupFixture, ok, eq, includes, excludes } from "./helpers.mjs";

export async function run() {
  await setupFixture();
  const screens = enumerate();
  const routes = screens.map((s) => s.route);

  includes(routes, "/", "enumerates home");
  includes(routes, "/dashboard", "enumerates /dashboard");
  includes(routes, "/reports", "enumerates /reports");
  includes(routes, "/reports/[id]", "enumerates the dynamic /reports/[id]");
  includes(routes, "/settings", "enumerates /settings");
  includes(routes, "/orphan-page", "enumerates the orphan page (the walk finds it)");
  includes(routes, "/about", "route group (marketing) stripped → /about");

  excludes(routes, "/should-not-route", "private _folder is NOT routed");
  ok(!routes.some((r) => r.includes("marketing")), "route-group segment removed from URL");
  ok(!routes.some((r) => r.includes("_components")), "private folder never surfaces");

  const dash = screens.find((s) => s.route === "/dashboard");
  ok(dash.capabilities.hasLoading === true, "dashboard hasLoading (co-located loading.tsx)");
  const home = screens.find((s) => s.route === "/");
  eq(home.id, "home", "home id is 'home'");
  ok(home.capabilities.hasLoading === false, "home hasLoading false (no own loading.tsx)");

  const rep = screens.find((s) => s.route === "/reports/[id]");
  ok(rep.dynamic === true, "reports/[id] is dynamic");
  eq(rep.params, ["id"], "reports/[id] params = [id]");
  ok(rep.resolved === false, "dynamic route unresolved before resolve()");

  eq(dash.group, "dashboard", "default group = first path segment");
  ok(screens.every((s) => Array.isArray(s.discoveredBy) && s.discoveredBy.includes("router-walk")), "all walk screens tagged discoveredBy router-walk");

  // Static edges (co-located source scan).
  const edges = deriveStaticEdges(screens);
  const has = (from, to) => edges.some((e) => e.from === from && e.to === to);
  ok(has("home", "dashboard"), "static edge home → dashboard");
  ok(has("home", "settings"), "static edge home → settings");
  ok(has("dashboard", "reports"), "static edge dashboard → reports");
  ok(has("reports", "reports__d_id"), "static edge reports → reports/[id] (template literal target)");
  ok(has("settings", "about"), "static edge settings → about");
}
