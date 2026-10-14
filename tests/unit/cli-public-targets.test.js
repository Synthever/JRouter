import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

describe("CLI tools and client public targets integration", () => {
  it("CoworkToolCard adds newly created combos with canonical jrouter/ prefix", () => {
    const cowork = read("src/app/(dashboard)/dashboard/cli-tools/components/CoworkToolCard.js");
    expect(cowork).toMatch(/name\.startsWith\(["']jrouter\/["']\)\s*\?\s*name\s*:\s*`jrouter\/\$\{name\}`/);
  });

  it("GenericCliToolCard handleAddAllActiveModels includes virtual targets from modelAliases", () => {
    const generic = read("src/app/(dashboard)/dashboard/cli-tools/components/GenericCliToolCard.js");
    expect(generic).toContain("modelAliases");
    expect(generic).toMatch(/jrouter\/\$\{alias\}|jrouter\//);
  });

  it("OpenClawToolCard preserves full public canonical target in settings", () => {
    const openclaw = read("src/app/(dashboard)/dashboard/cli-tools/components/OpenClawToolCard.js");
    expect(openclaw).toContain("9router/${selectedModel");
    expect(openclaw).toContain("id: selectedModel");
  });

  it("ToolDetailClient includes public virtual targets in available models", () => {
    const toolDetail = read("src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js");
    expect(toolDetail).toMatch(/\/api\/models\/public|\/api\/models\/alias/);
  });

  it("DefaultToolCard uses jrouter/ placeholder and enables selection when modelAliases exist", () => {
    const defaultCard = read("src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js");
    expect(defaultCard).toContain('placeholder="jrouter/alias-name');
    expect(defaultCard).toMatch(/activeProviders\?\.length.*modelAliases|modelAliases.*activeProviders/);
  });

  it("MitmPageClient considers modelAliases in hasActiveProviders check", () => {
    const mitm = read("src/app/(dashboard)/dashboard/mitm/MitmPageClient.js");
    expect(mitm).toMatch(/Object\.keys\(modelAliases\)\.length > 0/);
  });

  it("BasicChatPageClient targets /api/v1/chat/completions rather than nonexistent dashboard route", () => {
    const basicChat = read("src/app/(dashboard)/dashboard/basic-chat/BasicChatPageClient.js");
    expect(basicChat).not.toContain("/api/dashboard/chat/completions");
    expect(basicChat).toContain("/api/v1/chat/completions");
  });
});
