// Fixture (negative): reads a searchParam but it's free-text with no discoverable
// domain — the sweep must infer NOTHING and leave /search a single screen.
export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <main>Results for: {q ?? ""}</main>;
}
