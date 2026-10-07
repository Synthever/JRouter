// Local-only inference fixture for health API/browser validation; no live credentials.
import http from "node:http";
const state = { mode: "success", delayMs: 100, checks: 0, active: 0, maxActive: 0 };
http.createServer(async (request, response) => {
  let text = "";
  for await (const chunk of request) text += chunk;
  if (request.url === "/control") {
    if (request.method === "POST") Object.assign(state, JSON.parse(text || "{}"));
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(state)); return;
  }
  if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
  state.checks++; state.active++; state.maxActive = Math.max(state.maxActive, state.active);
  const body = JSON.parse(text || "{}");
  const mode = state.mode;
  await new Promise((resolve) => setTimeout(resolve, state.delayMs));
  state.active--;
  response.setHeader("Content-Type", "application/json");
  if (mode === "rate-limit") { response.writeHead(429); response.end(JSON.stringify({ error: { message: "rate limited Bearer fixture-secret sk-fixture-key", type: "rate_limit" } })); }
  else if (mode === "invalid") response.end(JSON.stringify({ object: "chat.completion" }));
  else response.end(JSON.stringify({ id: "fixture-completion", model: body.model, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
}).listen(20132, "127.0.0.1", () => console.log("Health fixture listening on 127.0.0.1:20132"));
