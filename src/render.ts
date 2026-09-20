import type { CardLine, Config, Theme } from "./config";
import { valueLines } from "./config";
import type { Stats } from "./github";

const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// For text interpolated into XML attributes (e.g. the configurable font
// family, the only free-form attribute value).
const escapeXmlAttribute = (text: string) =>
  escapeXml(text).replaceAll('"', "&quot;");

const formatNumber = (value: number) => value.toLocaleString("en-US");

const plural = (n: number, unit: string) =>
  `${String(n)} ${unit}${n === 1 ? "" : "s"}`;

const uptime = (uptimeStart: string | undefined) => {
  if (!uptimeStart) {
    throw new Error(
      'The {uptime} placeholder needs "uptimeStart" (ISO date) in the config.'
    );
  }

  const start = new Date(uptimeStart);
  const now = new Date();
  let months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    start.getUTCMonth();

  if (now.getUTCDate() < start.getUTCDate()) {
    months -= 1;
  }

  if (months < 0) {
    throw new Error(`uptimeStart (${uptimeStart}) is in the future.`);
  }

  const years = Math.floor(months / 12);
  const rest = months % 12;

  return rest === 0
    ? plural(years, "year")
    : `${plural(years, "year")}, ${plural(rest, "month")}`;
};

// Sentinels wrap {locAdded}/{locDeleted} through escaping so the final
// spans can color them. These reserved characters are rejected in config text.
const ADD_OPEN = "\u0001";
const ADD_CLOSE = "\u0002";
const DEL_OPEN = "\u0003";
const DEL_CLOSE = "\u0004";

const stripSentinels = (text: string) =>
  // oxlint-disable-next-line no-control-regex -- the sentinels above are control characters on purpose.
  text.replaceAll(/[\u0001-\u0004]/gu, "");

const colorizeSentinels = (escaped: string) =>
  escaped
    .replaceAll(ADD_OPEN, '<tspan class="added">')
    .replaceAll(DEL_OPEN, '<tspan class="deleted">')
    .replaceAll(ADD_CLOSE, "</tspan>")
    .replaceAll(DEL_CLOSE, "</tspan>");

const interpolate = (template: string, stats: Stats, config: Config) =>
  template
    .replaceAll("{repos}", formatNumber(stats.repos))
    .replaceAll("{contributedRepos}", formatNumber(stats.contributedRepos))
    .replaceAll("{stars}", formatNumber(stats.stars))
    .replaceAll("{followers}", formatNumber(stats.followers))
    .replaceAll("{contributions}", formatNumber(stats.contributions))
    .replaceAll("{topLanguages}", stats.topLanguages.join(", "))
    .replaceAll("{loc}", formatNumber(stats.loc))
    .replaceAll(
      "{locAdded}",
      `${ADD_OPEN}${formatNumber(stats.locAdded)}++${ADD_CLOSE}`
    )
    .replaceAll(
      "{locDeleted}",
      `${DEL_OPEN}${formatNumber(stats.locDeleted)}--${DEL_CLOSE}`
    )
    .replaceAll(
      "{uptime}",
      template.includes("{uptime}") ? uptime(config.uptimeStart) : ""
    );

interface RenderedLine {
  plain: string;
  spans: string;
}

// A missing key marks a continuation row without a dot leader.
const keyValueLine = (
  layout: Config["layout"],
  align: "left" | "right",
  key: string | undefined,
  value: string
): RenderedLine => {
  const prefix = key === undefined ? "" : `. ${key}: `;
  const plainValue = stripSentinels(value);
  const target =
    (align === "left"
      ? layout.valueColumn
      : layout.ruleWidth - plainValue.length) - prefix.length;
  const leader =
    key === undefined
      ? " ".repeat(Math.max(target, 0))
      : `${".".repeat(Math.max(target - 1, 0))} `;
  const keySpan =
    key === undefined
      ? ""
      : `<tspan class="dots">. </tspan><tspan class="key">${escapeXml(key)}</tspan>: `;

  return {
    plain: `${prefix}${leader}${plainValue}`,
    spans: `${keySpan}<tspan class="dots">${leader}</tspan><tspan class="value">${colorizeSentinels(escapeXml(value))}</tspan>`,
  };
};

const ruleLine = (
  layout: Config["layout"],
  label: string,
  isHeader: boolean
): RenderedLine => {
  const text = isHeader ? `${label} ` : `- ${label} `;
  const dashes = "—".repeat(Math.max(layout.ruleWidth - text.length, 0));
  return {
    plain: text + dashes,
    spans: `${escapeXml(text)}<tspan class="dots">${dashes}</tspan>`,
  };
};

// Apply casing after interpolation so fetched language names follow card.lowercase.
const renderLine = (
  line: CardLine,
  stats: Stats,
  config: Config
): RenderedLine[] => {
  const cased = (text: string) =>
    config.card.lowercase ? text.toLowerCase() : text;

  // oxlint-disable-next-line default-case -- exhaustive over the CardLine discriminated union; TypeScript errors here if a new variant appears.
  switch (line.type) {
    case "blank": {
      return [{ plain: "", spans: "" }];
    }
    case "header": {
      return [ruleLine(config.layout, cased(line.text), true)];
    }
    case "kv": {
      return valueLines(line.value).map((value, index) =>
        keyValueLine(
          config.layout,
          config.card.align,
          index === 0 ? cased(line.key) : undefined,
          cased(interpolate(value, stats, config))
        )
      );
    }
    case "section": {
      return [ruleLine(config.layout, cased(line.title), false)];
    }
  }
};

export const renderSvg = (
  config: Config,
  art: string[],
  stats: Stats,
  theme: Theme
): string => {
  const layout = { ...config.layout };
  for (const line of config.card.lines) {
    if (line.type === "kv") {
      const key = config.card.lowercase ? line.key.toLowerCase() : line.key;
      // Reserve ". " before the key and ":  " after it, even without dots.
      layout.valueColumn = Math.max(layout.valueColumn, key.length + 5);
    }
  }
  const renderConfig = { ...config, layout };
  const infoLines = config.card.lines.flatMap((line) =>
    renderLine(line, stats, renderConfig)
  );
  const artCols = Math.max(...art.map((line) => line.length));
  const infoCols = Math.max(...infoLines.map((line) => line.plain.length));
  const infoX =
    layout.paddingPx + artCols * layout.charWidthPx + layout.columnGapPx;
  const width = Math.ceil(
    infoX + infoCols * layout.charWidthPx + layout.paddingPx
  );
  const rows = Math.max(art.length, infoLines.length);
  const height = layout.paddingPx * 2 + rows * layout.rowHeightPx;
  // tspan y is the text BASELINE: place it 6px above the row's bottom edge
  // to leave room for descenders at the default 16px/20px type setting.
  const rowY = (index: number) =>
    layout.paddingPx + (index + 1) * layout.rowHeightPx - 6;

  const artSpans = art
    .map(
      (line, index) =>
        `<tspan x="${String(layout.paddingPx)}" y="${String(rowY(index))}">${escapeXml(line)}</tspan>`
    )
    .join("\n");
  const infoSpans = infoLines
    .map((line, index) =>
      line.spans
        ? `<tspan x="${String(Math.round(infoX))}" y="${String(rowY(index))}">${line.spans}</tspan>`
        : ""
    )
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}px" height="${String(height)}px" font-family="${escapeXmlAttribute(layout.fontFamily)}" font-size="${String(layout.fontSizePx)}px">
<style>
.key {fill: ${theme.key};}
.value {fill: ${theme.value};}
.dots {fill: ${theme.dots};}
.added {fill: ${theme.added};}
.deleted {fill: ${theme.deleted};}
text, tspan {white-space: pre;}
</style>
<rect width="${String(width)}px" height="${String(height)}px" fill="${theme.background}" rx="${String(layout.cornerRadiusPx)}"/>
<text fill="${theme.text}" xml:space="preserve">
${artSpans}
</text>
<text fill="${theme.text}" xml:space="preserve">
${infoSpans}
</text>
</svg>
`;
};
