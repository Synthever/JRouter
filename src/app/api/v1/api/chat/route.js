import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
import { withApiKeyPolicy } from "@/lib/apiKeyPolicy/gateway.js";
import { getPublicLlmTargetContext } from "@/lib/apiKeyPolicy/context.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {
  await ensureInitialized();
  return withApiKeyPolicy(request, async admittedRequest => {
    const authorized = getPublicLlmTargetContext();
    const response = await handleChat(admittedRequest, null, { publicTarget: authorized });
    return transformToOllama(response, authorized.target.publicId, { publicVirtual: true });
  }, { family: "chat", targetAdmission: "public-llm" });
}

