// Fixture: a query-param axis discoverable only from equality comparisons (no type,
// no backing array) — the equality-literal fallback path.
export default async function Board({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = tab === "open" ? "open" : tab === "closed" ? "closed" : tab === "archived" ? "archived" : "open";
  return <main>Board: {active}</main>;
}
