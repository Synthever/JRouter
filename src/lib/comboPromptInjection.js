import { ROLE, GEMINI_ROLE } from "open-sse/translator/schema/roles.js";
import { CLAUDE_BLOCK } from "open-sse/translator/schema/blocks.js";
import { FORMATS } from "open-sse/translator/formats.js";

export const PROMPT_INJECTION_MODES = ["prepend", "append", "replace"];
export const COMBO_PROMPT_VARIABLES = ["combo_name", "display_name", "requested_model"];
export const DEFAULT_COMBO_PROMPT_SETTINGS = {
  promptInjectionEnabled: false,
  promptInjectionMode: "prepend",
  systemPrompt: null,
  displayIdentity: null,
};

export function normalizeComboPromptSettings(data = {}) {
  return {
    promptInjectionEnabled: data.promptInjectionEnabled === true || data.promptInjectionEnabled === 1,
    promptInjectionMode: PROMPT_INJECTION_MODES.includes(data.promptInjectionMode) ? data.promptInjectionMode : DEFAULT_COMBO_PROMPT_SETTINGS.promptInjectionMode,
    systemPrompt: typeof data.systemPrompt === "string" ? data.systemPrompt : null,
    displayIdentity: typeof data.displayIdentity === "string" ? data.displayIdentity : null,
  };
}

// Only these four properties can be persisted by a behavior settings update.
export function validateComboPromptSettings(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid combo settings");
  const settings = {};
  for (const key of Object.keys(DEFAULT_COMBO_PROMPT_SETTINGS)) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (key === "promptInjectionEnabled" && typeof value !== "boolean") throw new Error("Prompt injection enabled must be a boolean");
    if (key === "promptInjectionMode" && !PROMPT_INJECTION_MODES.includes(value)) throw new Error("Injection strategy must be prepend, append or replace");
    if ((key === "systemPrompt" || key === "displayIdentity") && value !== null && typeof value !== "string") throw new Error(`${key} must be a string or null`);
    settings[key] = value;
  }
  return settings;
}

export function renderComboPrompt(combo, requestedModel = combo.name) {
  const variables = {
    combo_name: combo.name || "",
    display_name: combo.displayIdentity?.trim() || combo.name || "",
    requested_model: typeof requestedModel === "string" ? requestedModel : "",
  };
  return (typeof combo.systemPrompt === "string" ? combo.systemPrompt : "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name) => Object.hasOwn(variables, name) ? variables[name] : match);
}

const isInstruction = (message) => message?.role === ROLE.SYSTEM || message?.role === ROLE.DEVELOPER;

function composeMessages(messages, injection, mode) {
  if (mode === "replace") return [injection, ...messages.filter((message) => !isInstruction(message))];
  if (mode === "prepend") return [injection, ...messages];
  const lastInstruction = messages.findLastIndex(isInstruction);
  return [...messages.slice(0, lastInstruction + 1), injection, ...messages.slice(lastInstruction + 1)];
}

function composeBlocks(blocks, injection, mode) {
  if (mode === "replace") return [injection];
  return mode === "append" ? [...blocks, injection] : [injection, ...blocks];
}

/** Compose in the client's format so provider translators retain blocks, tool history and caching. */
export function applyComboPromptInjection(body, combo, { requestedModel, sourceFormat } = {}) {
  if (!combo) return body;
  const settings = normalizeComboPromptSettings(combo);
  if (!settings.promptInjectionEnabled) return body;
  const prompt = renderComboPrompt({ ...combo, ...settings }, requestedModel ?? body.model);
  if (!prompt.trim()) return body;
  const mode = settings.promptInjectionMode;

  if (Array.isArray(body.contents) || body.systemInstruction) {
    const blocks = Array.isArray(body.systemInstruction?.parts) ? body.systemInstruction.parts : [];
    return { ...body, systemInstruction: { ...body.systemInstruction, role: GEMINI_ROLE.USER, parts: composeBlocks(blocks, { text: prompt }, mode) } };
  }
  if (sourceFormat === FORMATS.CLAUDE || Object.hasOwn(body, "system")) {
    const blocks = Array.isArray(body.system) ? body.system : (typeof body.system === "string" && body.system ? [{ type: CLAUDE_BLOCK.TEXT, text: body.system }] : []);
    return {
      ...body,
      system: composeBlocks(blocks, { type: CLAUDE_BLOCK.TEXT, text: prompt }, mode),
      ...(Array.isArray(body.messages) && mode === "replace" ? { messages: body.messages.filter((message) => !isInstruction(message)) } : {}),
    };
  }
  if (Object.hasOwn(body, "input") || sourceFormat === FORMATS.OPENAI_RESPONSES) {
    const input = Array.isArray(body.input) ? body.input : (typeof body.input === "string" ? [{ role: ROLE.USER, content: body.input }] : []);
    const messages = typeof body.instructions === "string" && body.instructions ? [{ role: ROLE.SYSTEM, content: body.instructions }, ...input] : input;
    const { instructions, ...rest } = body;
    return { ...rest, input: composeMessages(messages, { role: ROLE.SYSTEM, content: prompt }, mode) };
  }
  if (Array.isArray(body.messages)) {
    return { ...body, messages: composeMessages(body.messages, { role: ROLE.SYSTEM, content: prompt }, mode) };
  }
  return body;
}
