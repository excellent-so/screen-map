// An ORPHAN: no other page links here (nothing has an href to /orphan-page), so the
// router-walk finds it but the graph reports it as an orphan — something a
// link-crawler alone can never find. It links out (not a dead-end).
import Link from "next/link";

export default function Orphan() {
  return (
    <main>
      <h1>Orphaned settings page</h1>
      <Link href="/">Home</Link>
    </main>
  );
}
