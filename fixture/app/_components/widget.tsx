// A private `_folder` — App Router opts this subtree OUT of routing. The walk must
// NOT emit a route for this file even though it looks like a component with links.
import Link from "next/link";
export function Widget() {
  return <Link href="/should-not-route">nope</Link>;
}
