import { describe, expect, it } from "vitest";
import { applyComboPromptInjection } from "@/lib/comboPromptInjection.js";
import { openaiToGeminiRequest } from "open-sse/translator/request/openai-to-gemini.js";
import { openaiToClaudeRequest } from "open-sse/translator/request/openai-to-claude.js";
import { openaiToOpenAIResponsesRequest } from "open-sse/translator/request/openai-responses.js";

const body = { messages: [{ role: "system", content: "Client" }, { role: "developer", content: "Developer" }, { role: "user", content: "Hello" }] };
const compose = (mode) => applyComboPromptInjection(body, { name: "test", promptInjectionEnabled: true, promptInjectionMode: mode, systemPrompt: "Combo" });

describe("combo instructions survive provider translation", () => {
  it.each(["prepend", "append", "replace"])("retains composed instructions for Gemini (%s)", (mode) => {
    const result = openaiToGeminiRequest("gemini-test", compose(mode), false);
    expect(result.systemInstruction.parts.map((p) => p.text)).toEqual(mode === "replace" ? ["Combo"] : mode === "prepend" ? ["Combo", "Client", "Developer"] : ["Client", "Developer", "Combo"]);
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].parts[0].text).toBe("Hello");
  });
  it.each(["prepend", "append", "replace"])("retains composed instructions for Responses (%s)", (mode) => {
    const result = openaiToOpenAIResponsesRequest("actual-model", compose(mode), false);
    expect(result.instructions).toBe(mode === "replace" ? "Combo" : mode === "prepend" ? "Combo\n\nClient\n\nDeveloper" : "Client\n\nDeveloper\n\nCombo");
    expect(result.input.filter((item) => item.role === "user")).toHaveLength(1);
  });
  it("handles preserved developer instructions as system-level instructions for Claude", () => {
    const result = openaiToClaudeRequest("actual-model", compose("prepend"), false);
    const text = typeof result.system === "string" ? result.system : result.system.map((p) => p.text).join("\n");
    expect(text).toContain("Combo");
    expect(text).toContain("Client");
    expect(text).toContain("Developer");
    expect(result.messages.filter((message) => message.role === "assistant")).toHaveLength(0);
  });
});
