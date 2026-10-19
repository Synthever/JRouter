export default {
  id: "beatapi",
  priority: 120,
  alias: "beatapi",
  aliases: [
    "beat",
  ],
  uiAlias: "beatapi",
  display: {
    name: "BeatAPI",
    icon: "graphic_eq",
    color: "#1258FF",
    textIcon: "BE",
    website: "https://beatapi.io",
    notice: {
      text: "OpenAI-compatible gateway. Free text model ids end in -free (glm-5.3, glm-5.3-flash, deepseek-v4.1-flash, deepseek-v4-flash-0731, gemini-3.8-flash). A zero-balance account may call only these; paid ids need a top-up.",
      apiKeyUrl: "https://beatapi.io/dashboard/apikeys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.beatapi.io/v1/chat/completions",
    validateUrl: "https://api.beatapi.io/v1/models",
    retry: {
      429: 2,
    },
  },
  // Free-model scope (user decision): only the -free ids. Both catalogue sources
  // agree on the same five ids; the fetcher below keeps the picker live when
  // BeatAPI rotates the set. jev-*-free is a Decisions API model, not text, so
  // the filter drops it by keeping only ids listed in the text catalogue.
  models: [
    { id: "glm-5.3-free", name: "GLM 5.3 (Free)" },
    { id: "glm-5.3-flash-free", name: "GLM 5.3 Flash (Free)" },
    { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash (Free)" },
    { id: "deepseek-v4-flash-0731-free", name: "DeepSeek V4 Flash 0731 (Free)" },
    { id: "gemini-3.8-flash-free", name: "Gemini 3.8 Flash (Free)" },
  ],
  modelsFetcher: { url: "https://api.beatapi.io/v1/text/models", type: "beatapi-free" },
  passthroughModels: true,
};
