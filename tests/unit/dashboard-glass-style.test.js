import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("dashboard transparent glass surfaces", () => {
  it("removes opaque tint, borders and shadows from overview cards", () => {
    const css = read("src/app/globals.css");
    const rules = [...css.matchAll(/\.dashboard-overview :is\(\.stat-card, \.ui-card\)\s*\{([^}]+)\}/g)];
    const base = rules[0]?.[1] || "";

    expect(base.includes("background-color: transparent;")).toBe(true);
    expect(base.includes("border: 0;")).toBe(true);
    expect(base.includes("box-shadow: none;")).toBe(true);
    expect(css.includes("var(--surface) 58%, transparent")).toBe(false);
    expect(rules.some(([, declarations]) => declarations.includes("backdrop-filter: blur(18px)"))).toBe(true);
    expect(css.includes("prefers-reduced-transparency: reduce")).toBe(true);
  });

  it("keeps inset surfaces transparent without another frame", () => {
    const css = read("src/app/globals.css");
    const inset = css.match(/\.dashboard-overview \.dashboard-card-inset\s*\{([^}]+)\}/)?.[1] || "";
    expect(inset.includes("background-color: transparent;")).toBe(true);
    expect(inset.includes("border: 0;")).toBe(true);
  });

  it("renders KPI icons directly without background or border tiles", () => {
    const source = read("src/app/(dashboard)/dashboard/components/KpiBentoGrid.js");
    for (const icon of ["Layers", "CheckCircle2", "Cpu", "DollarSign", "Server"]) {
      expect(new RegExp(`<${icon} className="size-4 shrink-0 text-`).test(source)).toBe(true);
    }
    expect(source.includes('className="p-1 rounded-[var(--r1)] bg-[var(--surface-2)] border')).toBe(false);
  });
});