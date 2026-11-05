// Fixture home — links into the app's main sections (a plain Next.js App Router
// app: no groups map, no navBackbone, no flows).
import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Fixture app</h1>
      <nav>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/settings">Settings</Link>
        <Link href="/reports">Reports</Link>
      </nav>
    </main>
  );
}
