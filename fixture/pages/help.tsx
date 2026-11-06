// A Pages Router page in an App Router app: Next serves it at /help, but the route walk
// reads only app/, so the crawl is what finds it (linked from /settings). The map shows
// it as a crawl-found screen, with its own screenshot.
import Link from "next/link";

export default function Help() {
  return (
    <main>
      <h1>Help</h1>
      <p>Questions and answers.</p>
      <Link href="/">Home</Link>
    </main>
  );
}
