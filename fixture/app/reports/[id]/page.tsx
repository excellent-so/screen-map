import Link from "next/link";

export default function Report({ params }: { params: { id: string } }) {
  return (
    <main>
      <h1>Report {params.id}</h1>
      <Link href="/reports">Back to all reports</Link>
    </main>
  );
}
