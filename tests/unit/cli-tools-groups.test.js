import { describe, expect, it } from "vitest";
import {
  STATUS_FILTERS,
  TOOL_GROUPS,
  TYPE_LABELS,
  countStatuses,
  filterEntries,
  groupTools,
  statusOf,
  toolEntries,
} from "@/app/(dashboard)/dashboard/cli-tools/components/cliToolGroups";

const cliTools = {
  claude: { name: "Claude Code", description: "Anthropic Claude Code CLI", configType: "env", group: "cli" },
  codex: { name: "OpenAI Codex CLI", description: "OpenAI Codex CLI", configType: "custom", group: "cli" },
  droid: { name: "Factory Droid", description: "Factory Droid AI Assistant", configType: "custom", group: "cli" },
  gem: { name: "Gemini Helper", description: "Lightweight assistant", configType: "custom", group: "cli" },
  copilot: { name: "GitHub Copilot", description: "Copilot in VS Code", configType: "guide", group: "ide" },
  cursor: { name: "Cursor", description: "Cursor AI editor", configType: "guide", group: "ide" },
};

const mitmTools = {
  antigravity: { name: "Antigravity", description: "Google Antigravity IDE", configType: "mitm" },
};

const statuses = {
  claude: { installed: true, hasJRouter: true },
  codex: { installed: true, hasJRouter: false },
  droid: { installed: false, hasJRouter: false },
};

describe("statusOf", () => {
  it("labels a configured tool as connected", () => {
    expect(statusOf(cliTools.claude, statuses.claude)).toEqual({
      key: "connected",
      label: "Connected",
      variant: "success",
      dot: true,
    });
  });

  it("labels an installed but unconfigured tool as needs setup", () => {
    expect(statusOf(cliTools.codex, statuses.codex).key).toBe("needs-setup");
  });

  it("labels a missing binary as not installed", () => {
    expect(statusOf(cliTools.droid, statuses.droid).key).toBe("not-installed");
  });

  it("lets the guide config type win over a status payload", () => {
    expect(statusOf(cliTools.copilot, { installed: true, hasJRouter: false }).key).toBe("guide");
  });

  it("labels a MITM tool as MITM instead of unknown", () => {
    expect(statusOf(mitmTools.antigravity, undefined).key).toBe("mitm");
  });

  it("reports unknown when no status was returned", () => {
    expect(statusOf(cliTools.claude, null).key).toBe("unknown");
    expect(statusOf(cliTools.claude, { error: "getaddrinfo ENOTFOUND" }).key).toBe("unknown");
  });
});

describe("countStatuses", () => {
  it("counts each bucket and excludes guide tools from installed buckets", () => {
    expect(countStatuses(cliTools, statuses)).toEqual({
      connected: 1,
      needsSetup: 1,
      notInstalled: 1,
      guide: 2,
      unknown: 1,
    });
  });

  it("treats every tool as unknown when no status payload was fetched at all", () => {
    expect(countStatuses(cliTools, undefined)).toEqual({
      connected: 0,
      needsSetup: 0,
      notInstalled: 0,
      guide: 2,
      unknown: 4,
    });
  });
});

describe("filterEntries", () => {
  const entries = toolEntries(cliTools, statuses, (id) => `/dashboard/cli-tools/${id}`);

  it("matches name, description and id case-insensitively", () => {
    expect(filterEntries(entries, { query: "COPILOT", status: "all" }).map((e) => e.id)).toEqual(["copilot"]);
    expect(filterEntries(entries, { query: "anthropic", status: "all" }).map((e) => e.id)).toEqual(["claude"]);
    expect(filterEntries(entries, { query: "codex", status: "all" }).map((e) => e.id)).toEqual(["codex"]);
  });

  it("isolates the id match from the name and description", () => {
    expect(filterEntries(entries, { query: "gem", status: "all" }).map((e) => e.id)).toEqual(["gem"]);
  });

  it("keeps only entries whose status key matches the filter", () => {
    expect(filterEntries(entries, { query: "", status: "needs-setup" }).map((e) => e.id)).toEqual(["codex"]);
    expect(filterEntries(entries, { query: "", status: "guide" }).map((e) => e.id)).toEqual(["copilot", "cursor"]);
  });

  it("treats a blank query and the all filter as no-op", () => {
    expect(filterEntries(entries, { query: "   ", status: "all" })).toHaveLength(6);
  });
});

describe("groupTools", () => {
  it("returns the three groups in fixed order with membership resolved", () => {
    const groups = groupTools(cliTools, mitmTools, statuses);
    expect(groups.map((g) => g.key)).toEqual(["cli", "ide", "mitm"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["claude", "codex", "droid", "gem"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["copilot", "cursor"]);
    expect(groups[2].entries.map((e) => e.id)).toEqual(["antigravity"]);
  });

  it("points MITM cards at the MITM page and everything else at a tool page", () => {
    const groups = groupTools(cliTools, mitmTools, statuses);
    expect(groups[2].entries[0].href).toBe("/dashboard/mitm");
    expect(groups[0].entries[0].href).toBe("/dashboard/cli-tools/claude");
  });

  it("falls back to the cli group when a tool declares no group", () => {
    const groups = groupTools({ loose: { name: "Loose", description: "", configType: "custom" } }, {}, {});
    expect(groups[0].entries.map((e) => e.id)).toEqual(["loose"]);
  });
});

describe("static tables", () => {
  it("exposes the five status filters", () => {
    expect(STATUS_FILTERS.map((f) => f.value)).toEqual(["all", "connected", "needs-setup", "not-installed", "guide"]);
  });

  it("exposes the three group descriptors", () => {
    expect(TOOL_GROUPS.map((g) => g.label)).toEqual(["CLI agents & TUI", "IDE & editor", "MITM tools"]);
  });

  it("maps every config type to a chip label", () => {
    expect(TYPE_LABELS).toEqual({ env: "Env vars", custom: "Config file", guide: "Guide", mitm: "MITM" });
  });
});

import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";

describe("catalog groups", () => {
  it("declares a valid group on every CLI tool", () => {
    const invalid = Object.entries(CLI_TOOLS)
      .filter(([, tool]) => tool.group !== "cli" && tool.group !== "ide")
      .map(([id]) => id);
    expect(invalid).toEqual([]);
  });

  it("keeps the approved group counts", () => {
    const cli = Object.values(CLI_TOOLS).filter((tool) => tool.group === "cli");
    const ide = Object.values(CLI_TOOLS).filter((tool) => tool.group === "ide");
    expect(cli).toHaveLength(20);
    expect(ide).toHaveLength(6);
    expect(Object.keys(MITM_TOOLS)).toHaveLength(2);
  });
});
