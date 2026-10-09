/**
 * The release as the repository shows it: the CHANGELOG entry of the version in package.json is dated (its heading
 * never says "unreleased" once the version is on npm; a section for the next version may), and the README opens
 * with the demo recording, right under the title. The recording stays out of the npm tarball (`files`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const PKG = JSON.parse(read("package.json").toString("utf8")) as { version: string; files: string[] };
const CHANGELOG = read("CHANGELOG.md").toString("utf8");
const README = read("README.md").toString("utf8");

describe("release", () => {
  it("the CHANGELOG entry of the package version carries its release date", () => {
    const heading = CHANGELOG.split("\n").find((line) => line.startsWith(`## ${PKG.version} `));
    expect(heading).toMatch(new RegExp(`^## ${PKG.version.replaceAll(".", "\\.")} \\(\\d{4}-\\d{2}-\\d{2}\\)$`));
    // Only the heading of the published version: a later "## x.y.z (unreleased)" section above it stays allowed.
    expect(heading).not.toMatch(/unreleased/i);
    expect(CHANGELOG).not.toContain("\u2014");
  });

  it("the README shows media/demo.gif right under the title, and the file is a GIF", () => {
    const lines = README.split("\n");
    expect(lines[0]).toBe("# Sirenic MCP server");
    expect(lines[2]).toMatch(/^!\[[^\]\u2014]+\]\(media\/demo\.gif\)$/);
    expect(README.match(/media\/demo\.gif/g)).toHaveLength(1);
    expect(read("media/demo.gif").subarray(0, 6).toString("latin1")).toBe("GIF89a");
  });

  it("the recording is not shipped in the npm tarball", () => {
    expect(PKG.files.some((entry) => entry.startsWith("media"))).toBe(false);
  });
});
