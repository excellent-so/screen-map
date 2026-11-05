// Lives under a route group `(marketing)` → routes as /about (group stripped). Has
// no outbound links → the graph reports it as a DEAD-END. Reached from /settings.
export default function About() {
  return (
    <main>
      <h1>About</h1>
      <p>No way out from here.</p>
    </main>
  );
}
