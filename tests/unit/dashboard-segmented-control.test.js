import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const require = createRequire(new URL("../../package.json", import.meta.url));
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function loadAnimatedBackground() {
  const filename = fileURLToPath(new URL("../../src/components/core/animated-background.js", import.meta.url));
  const { code } = require("next/dist/compiled/babel/core").transformSync(readFileSync(filename, "utf8"), {
    filename,
    presets: [require.resolve("next/babel")],
    babelrc: false,
    configFile: false,
    caller: { name: "test", supportsStaticESM: false },
  });
  const compiled = new Module(filename);
  compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL("../..", import.meta.url)));
  compiled.require = (specifier) => require(specifier === "@/shared/utils/cn"
    ? fileURLToPath(new URL("../../src/shared/utils/cn.js", import.meta.url))
    : specifier);
  compiled._compile(code, filename);
  return compiled.exports.AnimatedBackground;
}

function renderControl(props) {
  return renderToStaticMarkup(createElement(loadAnimatedBackground(), {
    className: "dashboard-segment-highlight",
    ...props,
  }, ["requests", "tokens", "cost"].map(value => createElement("button", {
    key: value,
    "data-id": value,
    type: "button",
  }, value))));
}

describe("dashboard animated segmented controls", () => {
  it("renders the default selection and one shared highlight", () => {
    const html = renderControl({ defaultValue: "requests" });
    expect(html).toMatch(/data-id="requests"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-id="tokens"[^>]*aria-pressed="false"/);
    expect(html.match(/class="[^"]*dashboard-segment-highlight/g)).toHaveLength(1);
  });

  it("uses the controlled value instead of an outdated default", () => {
    const html = renderControl({ defaultValue: "requests", value: "cost" });
    expect(html).toMatch(/data-id="cost"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-id="requests"[^>]*aria-pressed="false"/);
  });

  it("wires both selectors to their existing state and keeps refresh accessible", () => {
    const kpi = read("src/app/(dashboard)/dashboard/components/KpiBentoGrid.js");
    const timeline = read("src/app/(dashboard)/dashboard/components/ActivityTimelineCard.js");
    expect(kpi).toContain("value={period}");
    expect(kpi).toContain("onValueChange={onPeriodChange}");
    expect(kpi).toContain("data-id={p.value}");
    expect(timeline).toContain("value={viewMode}");
    expect(timeline).toContain("onValueChange={setViewMode}");
    expect(timeline).toContain("data-id={m.value}");
    expect(kpi).toContain('aria-label="Refresh telemetry"');
    expect(kpi).toContain("disabled={fetching}");
  });

  it("uses the same borderless controls for request logs and telemetry", () => {
    const logs = read("src/app/(dashboard)/dashboard/components/LatestRequestsTable.js");
    expect(logs).toContain("value={layout}");
    expect(logs).toContain("onValueChange={setLayout}");
    expect(logs).toContain('containerClassName="dashboard-segmented-control"');
    expect(logs).toContain('className="dashboard-segment-highlight"');
    expect(logs).toContain('data-id="table"');
    expect(logs).toContain('data-id="cards"');
    expect(logs).toContain('aria-label="Refresh logs"');
    expect(logs).toContain('className="dashboard-refresh"');
  });

  it("uses theme tokens, reduced motion and visible keyboard focus", () => {
    const css = read("src/app/globals.css");
    const source = read("src/components/core/animated-background.js");
    const highlight = css.match(/\.dashboard-segment-highlight\s*\{([^}]+)\}/)?.[1] || "";
    const refresh = css.match(/\.dashboard-refresh\s*\{([^}]+)\}/)?.[1] || "";
    expect(highlight).toContain("background-color: var(--surface);");
    expect(refresh).toContain("background: transparent;");
    expect(refresh).toContain("border: 0;");
    expect(source).toContain("useReducedMotion");
    expect(source).toContain('ease: "easeInOut", duration: 0.2');
    expect(css).toMatch(/\.dashboard-segment:focus-visible,[\s\S]*?outline: 2px solid var\(--text-2\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dashboard-segment:active[\s\S]*?transform: none/);
  });
});