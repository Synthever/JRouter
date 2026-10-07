import { getConfiguredHealthModels } from "@/lib/health/catalog.js";
import { checkAllModels, getHealthSummary, HealthError } from "@/lib/health/service.js";
import { claimLease, renewLease, releaseLease } from "@/lib/db/repos/modelHealthRepo.js";
import { healthRoute } from "@/lib/health/api.js";
export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = healthRoute(async (request) => {
  const models = await getConfiguredHealthModels();
  const lease = await claimLease("manual-batch");
  if (!lease) throw new HealthError("Test All Models is already running", 409);
  const cancel = new AbortController();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (value) => { if (!closed) { try { controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); } catch { closed = true; cancel.abort(); } } };
      const heartbeat = setInterval(() => { renewLease(lease).catch(() => cancel.abort()); }, 15000);
      heartbeat.unref?.();
      try {
        send({ type: "start", total: models.length });
        const progress = await checkAllModels({ models, signal: AbortSignal.any([request.signal, cancel.signal]), onResult: (result) => send({ type: "result", ...result }) });
        send({ type: "done", ...progress, summary: await getHealthSummary() });
      } catch { send({ type: "error", error: "Health check batch could not be completed" }); }
      finally {
        clearInterval(heartbeat);
        await releaseLease(lease);
        if (!closed) { try { controller.close(); } catch {} }
      }
    },
    cancel() { cancel.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});
