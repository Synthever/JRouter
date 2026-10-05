import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const require = createRequire(new URL("../../package.json", import.meta.url));
const filename = fileURLToPath(new URL("../../src/shared/components/ui/chart.js", import.meta.url));
const { code } = require("next/dist/compiled/babel/core").transformSync(readFileSync(filename, "utf8"), {
  filename,
  presets: [require.resolve("next/babel")],
  babelrc: false,
  configFile: false,
  caller: { name: "test", supportsStaticESM: false },
});
const compiled = new Module(filename);
compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL("../..", import.meta.url)));
compiled.require = (specifier) => {
  if (specifier.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => key });
  return require(specifier === "@/shared/utils/cn"
    ? fileURLToPath(new URL("../../src/shared/utils/cn.js", import.meta.url))
    : specifier);
};
compiled._compile(code, filename);
const { ChartContainer, ChartTooltipContent } = compiled.exports;
const config = { requests: { label: "Requests", color: "var(--text-2)" } };

function renderTooltip(props) {
  return renderToStaticMarkup(createElement(ChartContainer, { config },
    createElement(ChartTooltipContent, {
      active: true,
      label: "Provider A",
      payload: [{ name: "requests", dataKey: "requests", value: 1234, color: "var(--text)", payload: {} }],
      ...props,
    })));
}

describe("shadcn chart tooltip", () => {
  it("uses configured metric labels and each bar's category color", () => {
    const html = renderTooltip({ payload: [{ name: "requests", dataKey: "requests", value: 1234, payload: { fill: "var(--text-2)" } }] });
    expect(html).toContain("Provider A");
    expect(html).toContain("Requests");
    expect(html).toContain((1234).toLocaleString());
    expect(html).toContain("--indicator-color:var(--text-2)");
  });

  it("keeps zero values visible and escapes provider labels", () => {
    const html = renderTooltip({ label: "<script>provider</script>", payload: [{ name: "requests", dataKey: "requests", value: 0, payload: {} }] });
    expect(html).toContain(">0</span>");
    expect(html).toContain("&lt;script&gt;provider&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("does not display inactive or empty tooltip content", () => {
    expect(renderTooltip({ active: false })).not.toContain('data-slot="chart-tooltip"');
    expect(renderTooltip({ payload: [] })).not.toContain('data-slot="chart-tooltip"');
  });
});