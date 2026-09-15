import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderArt } from "./art";
import type { Config } from "./config";
import { XML_TEXT_PATTERN } from "./config";

// Renders the generative art into a temp dir (it is an intermediate — only
// the SVGs get published), then converts it to ASCII with
// ascii-image-converter (https://github.com/TheZoraiz/ascii-image-converter).
// Install locally: `brew install TheZoraiz/ascii-image-converter/ascii-image-converter`.
export const generateAsciiArt = async (
  config: Config,
  rows: number
): Promise<string[]> => {
  const workDir = mkdtempSync(
    path.join(os.tmpdir(), "ascii-profile-card-art-")
  );
  const artFile = path.join(workDir, "art.png");

  try {
    await renderArt(config.art, rows, artFile);

    const proc = Bun.spawn(
      [
        "ascii-image-converter",
        artFile,
        "--dimensions",
        `${String(config.art.columns)},${String(rows)}`,
        ...config.ascii.flags,
      ],
      {
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `ascii-image-converter failed (${String(exitCode)}):\n${stderr}`
      );
    }

    if (!XML_TEXT_PATTERN.test(stdout)) {
      throw new Error(
        "ascii-image-converter returned characters forbidden in XML 1.0. Check ascii.flags."
      );
    }

    // Trim only trailing newlines: space-only rows are real art content
    // (dark regions of the field) and must keep their place.
    const lines = stdout.replace(/\n+$/u, "").split("\n");
    if (
      lines.length !== rows ||
      lines.some((line) => line.length !== config.art.columns)
    ) {
      throw new Error(
        `ascii-image-converter must return ${String(config.art.columns)} columns and ${String(rows)} rows. Check ascii.flags.`
      );
    }
    return lines;
  } finally {
    rmSync(workDir, { force: true, recursive: true });
  }
};
