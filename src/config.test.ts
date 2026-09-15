import { describe, expect, test } from "bun:test";

import { getCardRowCount, loadConfig } from "./config";

describe("card configuration", () => {
  test("accepts 48 entries and rejects a 49th", () => {
    const lines = Array.from({ length: 48 }, () => ({ type: "blank" }));

    expect(
      loadConfig(JSON.stringify({ card: { lines } })).card.lines
    ).toHaveLength(48);
    expect(() =>
      loadConfig(
        JSON.stringify({ card: { lines: [...lines, { type: "blank" }] } })
      )
    ).toThrow("Invalid config:");
  });

  test("limits expanded rows independently of the number of entries", () => {
    const lines = Array.from({ length: 8 }, () => ({
      key: "Stack",
      type: "kv",
      value: "x\n".repeat(30),
    }));
    const config = loadConfig(
      JSON.stringify({
        card: {
          lines: [
            ...lines,
            { key: "More", type: "kv", value: "x\n".repeat(16) },
          ],
        },
      })
    );

    expect(getCardRowCount(config.card.lines)).toBe(256);
    expect(() =>
      loadConfig(
        JSON.stringify({
          card: {
            lines: [
              ...lines,
              { key: "More", type: "kv", value: "x\n".repeat(17) },
            ],
          },
        })
      )
    ).toThrow("card exceeds 256 rows after expanding multiline values");
  });

  test("counts line breaks toward the 120-character value limit", () => {
    const value = `${"a".repeat(59)}\n${"b".repeat(60)}`;
    const line = { key: "Stack", type: "kv", value };
    const config = loadConfig(JSON.stringify({ card: { lines: [line] } }));

    expect(getCardRowCount(config.card.lines)).toBe(2);
    line.value += "c";
    expect(() =>
      loadConfig(JSON.stringify({ card: { lines: [line] } }))
    ).toThrow("Invalid config:");
  });

  test("rejects output files that differ only by case", () => {
    expect(() =>
      loadConfig(
        JSON.stringify({
          card: { lines: [{ type: "blank" }] },
          output: { dark: "Card.svg", light: "card.svg" },
        })
      )
    ).toThrow("dark and light output file names must differ, ignoring case");
  });

  test.each([
    { text: "bad\u0000text", type: "header" },
    { title: "bad\u0000text", type: "section" },
    { key: "bad\u0000text", type: "kv", value: "Go" },
    { key: "Stack", type: "kv", value: "bad\u0000text" },
  ])("rejects XML-forbidden characters in card text: %j", (line) => {
    expect(() =>
      loadConfig(JSON.stringify({ card: { lines: [line] } }))
    ).toThrow("contains a character forbidden in XML 1.0");
  });

  test("normalizes decomposed text before measuring its length", () => {
    const config = loadConfig(
      JSON.stringify({
        card: { lines: [{ text: "e\u0301".repeat(80), type: "header" }] },
      })
    );

    expect(config.card.lines).toStrictEqual([
      { text: "\u00E9".repeat(80), type: "header" },
    ]);
  });
});
