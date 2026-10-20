import { describe, expect, it } from "vitest";
import manifest from "../../src/app/manifest.js";

// An installed PWA inherits its orientation lock from the manifest. A portrait
// lock makes the standalone app unable to rotate even though the same pages
// rotate normally in a browser tab, so keep the orientation unlocked.
describe("PWA manifest orientation", () => {
  it("does not lock the installed app to portrait", () => {
    expect(manifest().orientation).toBe("any");
  });
});
