import { describe, expect, it } from "vitest";
import { applyComboPromptInjection, renderComboPrompt, validateComboPromptSettings } from "@/lib/comboPromptInjection.js";

const combo = { name: "claude-smart", promptInjectionEnabled: true, promptInjectionMode: "prepend", systemPrompt: "You are {{display_name}}.\nCombo: {{combo_name}}; requested: {{requested_model}}", displayIdentity: "Claude Sonnet" };
const inject = (body, mode = "prepend", format) => applyComboPromptInjection(body, { ...combo, promptInjectionMode: mode }, { requestedModel: "claude-smart", sourceFormat: format });
const client = { role: "system", content: "Client rules" };
const developer = { role: "developer", content: [{ type: "text", text: "Developer rules" }] };
const user = { role: "user", content: "Hello" };
const assistant = { role: "assistant", content: "Hi" };

describe("combo prompt composition", () => {
  it("renders only allowlisted variables once, keeping unknown variables literal", () => {
    expect(renderComboPrompt({ ...combo, displayIdentity: "{{api_key}}", systemPrompt: "{{combo_name}} {{display_name}} {{requested_model}} {{api_key}} {{provider}}" }, "requested")).toBe("claude-smart {{api_key}} requested {{api_key}} {{provider}}");
    expect(renderComboPrompt({ ...combo, displayIdentity: null }, "x")).toContain("You are claude-smart.");
  });
  it.each([{}, { promptInjectionEnabled: false }, { systemPrompt: " \n " }, { systemPrompt: null }])("leaves disabled, legacy and blank configs unchanged: %j", (patch) => {
    const body = { model: "real/model", messages: [client, user] };
    expect(applyComboPromptInjection(body, Object.keys(patch).length ? { ...combo, ...patch } : {})).toBe(body);
  });
  it("prepends without mutating input, routing metadata, or conversation order", () => {
    const body = { model: "real/model", messages: [client, user, assistant, developer], tools: [{ type: "function" }] };
    const original = structuredClone(body);
    const result = inject(body);
    expect(result.messages).toEqual([{ role: "system", content: renderComboPrompt(combo, "claude-smart") }, ...body.messages]);
    expect(body).toEqual(original);
    expect(result.model).toBe("real/model");
    expect(result.tools).toBe(body.tools);
  });
  it("appends after every instruction without reordering conversation messages", () => {
    const result = inject({ messages: [client, user, assistant, developer] }, "append");
    expect(result.messages.slice(0, 4)).toEqual([client, user, assistant, developer]);
    expect(result.messages[4].content).toContain("You are Claude Sonnet");
  });
  it("replaces system and developer instructions while preserving history and tool results", () => {
    const tool = { role: "tool", tool_call_id: "abc", content: "result" };
    expect(inject({ messages: [client, user, assistant, developer, tool] }, "replace").messages.slice(1)).toEqual([user, assistant, tool]);
  });
  it.each(["prepend", "append", "replace"])("injects with no client instructions (%s)", (mode) => {
    const messages = inject({ messages: [user] }, mode).messages;
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toBe(user);
  });
  it("falls back to prepend for invalid legacy modes", () => {
    expect(inject({ messages: [client, user] }, "invalid").messages[0].content).toContain("You are Claude Sonnet");
  });
  it("keeps Claude system blocks and their cache controls intact", () => {
    const block = { type: "text", text: "Client", cache_control: { type: "ephemeral" } };
    const body = { system: [block], messages: [user] };
    expect(inject(body, "append", "claude").system[0]).toBe(block);
    expect(inject(body, "replace", "claude").system).toHaveLength(1);
    expect(inject({ messages: [user] }, "prepend", "claude").system[0].text).toContain("You are Claude Sonnet");
    expect(body.system).toEqual([block]);
  });
  it("handles Responses instructions, input messages and function items", () => {
    const fn = { type: "function_call_output", call_id: "abc", output: "result" };
    const body = { instructions: "Top-level client rules", input: [developer, user, fn] };
    const result = inject(body, "append");
    expect(result.instructions).toBeUndefined();
    expect(result.input).toEqual([{ role: "system", content: body.instructions }, developer, expect.objectContaining({ role: "system" }), user, fn]);
    expect(inject(body, "replace").input.slice(1)).toEqual([user, fn]);
    expect(inject({ input: "Hello" }, "prepend").input[1]).toEqual(user);
  });
  it("composes Gemini system parts without touching multimedia contents", () => {
    const body = { systemInstruction: { parts: [{ text: "Client" }] }, contents: [{ role: "user", parts: [{ inlineData: { data: "abc", mimeType: "image/png" } }] }] };
    expect(inject(body, "append").systemInstruction.parts[0]).toBe(body.systemInstruction.parts[0]);
    expect(inject(body, "replace").systemInstruction.parts).toHaveLength(1);
    expect(inject(body).contents).toBe(body.contents);
  });
});

describe("combo prompt validation", () => {
  it("accepts partial updates, nulls and multiline prompts", () => {
    expect(validateComboPromptSettings({})).toEqual({});
    expect(validateComboPromptSettings({ systemPrompt: "line one\nline two", displayIdentity: null })).toEqual({ systemPrompt: "line one\nline two", displayIdentity: null });
  });
  it.each([{ promptInjectionMode: "invalid" }, { promptInjectionEnabled: "true" }, { systemPrompt: {} }, { displayIdentity: 1 }])("rejects invalid persisted types: %j", (body) => {
    expect(() => validateComboPromptSettings(body)).toThrow();
  });
});
