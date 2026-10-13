function transformPublicOllama(response, model) {
  if (!response.body) return response;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let failed = false;
  let terminal = null;
  const calls = {};
  const emit = (controller, value) => controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
  function frame(raw, controller) {
    if (failed) return;
    const data = raw.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    if (parsed.error || parsed.type === "error") {
      failed = true; terminal = null;
      emit(controller, { model, error: parsed.error?.message || parsed.error || "Upstream stream failed" });
      return;
    }
    const choice = parsed.choices?.[0];
    const delta = choice?.delta || {};
    for (const call of delta.tool_calls || []) {
      const saved = calls[call.index ?? 0] ||= { name: "", arguments: "" };
      saved.name += call.function?.name || ""; saved.arguments += call.function?.arguments || "";
    }
    if (delta.content || delta.reasoning_content) emit(controller, { model, message: { role: "assistant", content: delta.content || "", ...(delta.reasoning_content ? { thinking: delta.reasoning_content } : {}) }, done: false });
    if (choice?.finish_reason) {
      terminal = choice.finish_reason;
      const toolCalls = Object.values(calls).map(call => ({ function: { name: call.name, arguments: (() => { try { return JSON.parse(call.arguments || "{}"); } catch { return {}; } })() } }));
      if (toolCalls.length) {
        emit(controller, { model, message: { role: "assistant", content: "", tool_calls: toolCalls }, done: false });
        for (const index of Object.keys(calls)) delete calls[index];
      }
    }
  }
  function drain(controller, final = false) {
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const end = match.index + match[0].length; frame(buffer.slice(0, end), controller); buffer = buffer.slice(end);
    }
    if (final && buffer) { frame(buffer, controller); buffer = ""; }
  }
  return new Response(response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { buffer += decoder.decode(chunk, { stream: true }); drain(controller); },
    flush(controller) {
      buffer += decoder.decode(); drain(controller, true);
      if (failed) return;
      const toolCalls = Object.values(calls).map(call => ({ function: { name: call.name, arguments: (() => { try { return JSON.parse(call.arguments || "{}"); } catch { return {}; } })() } }));
      emit(controller, { model, message: { role: "assistant", content: "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, done: true, ...(terminal ? { done_reason: terminal } : {}) });
    },
  })), { status: response.status, headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" } });
}

async function transformPublicOllamaJson(response, model) {
  const body = await response.json();
  if (body.error) return Response.json(body, { status: response.status });
  const choice = body.choices?.[0];
  const message = choice?.message || {};
  const toolCalls = (message.tool_calls || []).map(call => ({ function: {
    name: call.function?.name || "",
    arguments: (() => {
      const value = call.function?.arguments;
      if (typeof value !== "string") return value || {};
      try { return JSON.parse(value || "{}"); } catch { return {}; }
    })(),
  } }));
  return Response.json({
    model, message: { role: "assistant", content: message.content || "",
      ...(message.reasoning_content ? { thinking: message.reasoning_content } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    done: true, ...(choice?.finish_reason ? { done_reason: choice.finish_reason } : {}),
    ...(body.usage ? { prompt_eval_count: body.usage.prompt_tokens || 0, eval_count: body.usage.completion_tokens || 0 } : {}),
  }, { status: response.status, headers: { "Access-Control-Allow-Origin": "*" } });
}

// Transform OpenAI SSE stream to Ollama JSON lines format
export function transformToOllama(response, model, { publicVirtual = false } = {}) {
  if (!response.ok) return response;
  if (publicVirtual) {
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    return contentType === "application/json" ? transformPublicOllamaJson(response, model) : transformPublicOllama(response, model);
  }
  let buffer = "";
  let pendingToolCalls = {};
  
  const transform = new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk);
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        
        if (data === "[DONE]") {
          const ollamaEnd = JSON.stringify({ model, message: { role: "assistant", content: "" }, done: true }) + "\n";
          controller.enqueue(new TextEncoder().encode(ollamaEnd));
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta || {};
          const content = delta.content || "";
          const toolCalls = delta.tool_calls;

          if (toolCalls) {
            for (const tc of toolCalls) {
              const idx = tc.index;
              if (!pendingToolCalls[idx]) {
                pendingToolCalls[idx] = { id: tc.id, function: { name: "", arguments: "" } };
              }
              if (tc.function?.name) pendingToolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments) pendingToolCalls[idx].function.arguments += tc.function.arguments;
            }
          }

          if (content) {
            const ollama = JSON.stringify({ model, message: { role: "assistant", content }, done: false }) + "\n";
            controller.enqueue(new TextEncoder().encode(ollama));
          }

          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason === "tool_calls" || finishReason === "stop") {
            const toolCallsArr = Object.values(pendingToolCalls);
            if (toolCallsArr.length > 0) {
              const formattedCalls = toolCallsArr.map(tc => ({
                function: {
                  name: tc.function.name,
                  arguments: (() => { try { return JSON.parse(tc.function.arguments || "{}"); } catch { return {}; } })()
                }
              }));
              const ollama = JSON.stringify({ 
                model, 
                message: { role: "assistant", content: "", tool_calls: formattedCalls }, 
                done: true
              }) + "\n";
              controller.enqueue(new TextEncoder().encode(ollama));
              pendingToolCalls = {};
            } else if (finishReason === "stop") {
              const ollamaEnd = JSON.stringify({ model, message: { role: "assistant", content: "" }, done: true }) + "\n";
              controller.enqueue(new TextEncoder().encode(ollamaEnd));
            }
          }
        } catch (e) {
          // Silently ignore parse errors
        }
      }
    },
    flush(controller) {
      const ollamaEnd = JSON.stringify({ model, message: { role: "assistant", content: "" }, done: true }) + "\n";
      controller.enqueue(new TextEncoder().encode(ollamaEnd));
    }
  });

  if (!response.body) {
    return new Response("", { status: response.status, headers: { "Content-Type": "application/x-ndjson" } });
  }
  return new Response(response.body.pipeThrough(transform), {
    headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" }
  });
}

