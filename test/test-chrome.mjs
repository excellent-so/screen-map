// Chrome strategy: detection surface + the missing-browser message (no network).
import { findChrome, missingBrowserMessage, resolveChrome } from "../src/chrome.mjs";
import { ok } from "./helpers.mjs";

export async function run() {
  // An explicit path that exists wins.
  const self = process.execPath; // node binary — a real file to prove explicit-path resolution
  ok(findChrome(self) === self, "explicit existing path is honored");
  ok(findChrome("/definitely/not/a/real/chrome/binary") !== "/definitely/not/a/real/chrome/binary", "bogus explicit path is not returned verbatim");

  const msg = missingBrowserMessage();
  ok(msg.includes("SCREENMAP_CHROME"), "missing-browser message documents the env override");
  ok(msg.includes("--download-chrome"), "missing-browser message documents on-demand download");
  ok(msg.includes("never runs a hidden postinstall"), "missing-browser message states the no-postinstall guarantee");

  // resolveChrome with a bogus explicit and no download → never throws, never invents a
  // path. On a machine WITH system Chrome it falls through to it (has:true, source:"system");
  // on one WITHOUT, it degrades to has:false/source:null. Both are correct — assert the invariant.
  const said = [];
  const r = await resolveChrome({ explicit: "/nope/chrome", allowDownload: false, log: (m) => said.push(m) });
  ok(said.some((m) => m.includes("No browser at /nope/chrome")), "a SCREENMAP_CHROME or config path with no browser there says so, rather than being ignored");
  if (r.has) {
    ok(r.path && r.path !== "/nope/chrome" && r.source !== null, "resolveChrome falls through bogus explicit to a real system browser");
  } else {
    ok(r.path === null && r.source === null, "resolveChrome degrades to has:false when no browser is present");
  }
}
