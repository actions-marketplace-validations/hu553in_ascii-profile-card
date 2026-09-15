import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config";
import type { Stats } from "./github";
import { renderSvg } from "./render";

const stats: Stats = {
  contributedRepos: 0,
  contributions: 0,
  followers: 0,
  loc: 0,
  locAdded: 0,
  locDeleted: 0,
  repos: 0,
  stars: 0,
  topLanguages: [],
};

const infoRows = "/*/*[local-name()='text'][2]/*";
const artRows = "/*/*[local-name()='text'][1]/*";

const xpath = (svg: string, expression: string): string =>
  execFileSync("xmllint", ["--xpath", expression, "-"], {
    encoding: "utf-8",
    input: svg,
  }).replace(/\n$/u, "");

describe("card rendering", () => {
  test.each([
    ["left", [22, 22, 22], [24, 32, 26]],
    ["right", [38, 30, 36], [40, 40, 40]],
  ] satisfies [string, number[], number[]][])(
    "aligns multiline values to the %s",
    (align, starts, ends) => {
      const config = loadConfig(
        JSON.stringify({
          card: {
            align,
            lines: [
              { key: "A much longer key", type: "kv", value: "Go\nTypeScript" },
              { key: "Short", type: "kv", value: "Rust" },
            ],
          },
          layout: { ruleWidth: 40, valueColumn: 8 },
        })
      );
      const svg = renderSvg(config, ["#"], stats, config.themes.dark);

      expect(xpath(svg, `count(${infoRows})`)).toBe("3");
      expect(xpath(svg, `count(${infoRows}[2]/*[@class='key'])`)).toBe("0");
      expect(
        xpath(svg, `string(${infoRows}[2]/*[@class='dots'])`)
      ).not.toContain(".");
      const rows = [1, 2, 3].map((index) =>
        xpath(svg, `string(${infoRows}[${index}])`)
      );

      expect(
        rows.map((row) => row.search(/Go|TypeScript|Rust/u))
      ).toStrictEqual(starts);
      expect(rows.map((row) => row.length)).toStrictEqual(ends);
    }
  );

  test.each(["\n", "\r\n", "\r"])(
    "preserves internal blank rows with %j line endings",
    (newline) => {
      const config = loadConfig(
        JSON.stringify({
          card: {
            lines: [
              {
                key: "Stack",
                type: "kv",
                value: `First${newline}${newline}Third${newline}${newline}`,
              },
            ],
          },
          layout: { paddingPx: 10, rowHeightPx: 20 },
        })
      );
      const svg = renderSvg(config, ["#"], stats, config.themes.dark);

      expect(xpath(svg, `count(${infoRows})`)).toBe("3");
      expect(
        [1, 2, 3].map((index) =>
          xpath(svg, `string(${infoRows}[${index}]/*[@class='value'])`)
        )
      ).toStrictEqual(["First", "", "Third"]);
      expect(
        [1, 2, 3].map((index) => xpath(svg, `string(${infoRows}[${index}]/@y)`))
      ).toStrictEqual(["24", "44", "64"]);
      expect(xpath(svg, "string(/*/@height)")).toBe("80px");
    }
  );

  test("escapes text and attributes without losing their content", () => {
    const config = loadConfig(
      JSON.stringify({
        card: {
          lines: [{ key: "A&B", type: "kv", value: "<Go>\nTypeScript & Rust" }],
        },
        layout: { fontFamily: '"Mono" & <Fallback>' },
      })
    );
    const svg = renderSvg(config, ["<&>"], stats, config.themes.dark);

    expect(xpath(svg, "string(/*/@font-family)")).toBe('"Mono" & <Fallback>');
    expect(xpath(svg, `string(${artRows}[1])`)).toBe("<&>");
    expect(xpath(svg, `string(${infoRows}[1]/*[@class='key'])`)).toBe("A&B");
    expect(xpath(svg, `string(${infoRows}[1]/*[@class='value'])`)).toBe("<Go>");
    expect(xpath(svg, `string(${infoRows}[2]/*[@class='value'])`)).toBe(
      "TypeScript & Rust"
    );
  });

  test("grows ASCII art to match multiline content in both CLI outputs", () => {
    const outputDir = mkdtempSync(
      path.join(tmpdir(), "ascii-profile-card-test-")
    );

    try {
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("main.ts", import.meta.url))],
        {
          env: {
            ...process.env,
            CONFIG: JSON.stringify({
              art: { columns: 8, rows: 8, seed: "test", width: 64 },
              card: {
                lines: [{ key: "Stack", type: "kv", value: "Go\n".repeat(12) }],
              },
              layout: { paddingPx: 10, rowHeightPx: 20 },
              login: "octocat",
            }),
            GITHUB_TOKEN: "",
            OUTPUT_DIR: outputDir,
          },
          timeout: 10_000,
        }
      );

      for (const name of ["dark_mode.svg", "light_mode.svg"]) {
        const svg = readFileSync(path.join(outputDir, name), "utf-8");

        expect(xpath(svg, `count(${artRows})`)).toBe("12");
        expect(xpath(svg, `count(${infoRows})`)).toBe("12");
        expect(xpath(svg, `string(${infoRows}[12]/*[@class='value'])`)).toBe(
          "Go"
        );
        expect(xpath(svg, "string(/*/@height)")).toBe("260px");
      }
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  }, 15_000);
});
