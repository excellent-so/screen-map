import Link from "next/link";

const reports = ["q1", "q2", "q3"];

export default function Reports() {
  return (
    <main>
      <h1>Reports</h1>
      <ul>
        {reports.map((id) => (
          <li key={id}>
            <Link href={`/reports/${id}`}>Report {id}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
