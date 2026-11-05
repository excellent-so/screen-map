// The fixture's config is deliberately MINIMAL — it proves a plain app maps cleanly
// with no groups map, no navBackbone, no flows and no coldStartPattern. Everything
// else is zero-config / auto-detected.
export default {
  devBaseUrl: "http://localhost:3100",
  // appDir auto-detected as "app"; groups default to the first path segment.
  output: { adapter: "markdown" },
};
