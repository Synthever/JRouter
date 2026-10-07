// Exercise an isolated running dashboard against model-health-provider.mjs.
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:20130";
const fixture = "http://127.0.0.1:20132";
const modelId = "health-fixture/model-a";
const api = async (path, method = "GET", body) => {
  const response = await fetch(`${base}/api/model-health${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
};
const control = async (body) => (await fetch(`${fixture}/control`, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) })).json();
const check = () => api("/check", "POST", { modelId });
const config = (body) => api(`/config?${new URLSearchParams({ modelId })}`, "PUT", body);

try {
  await control({ mode: "success", delayMs: 20 });
  const initial = await control();
  for (const range of ["24h", "3d", "7d"]) {
    const response = await api(`?range=${range}`);
    assert.equal(response.status, 200); assert.equal(response.data.models.length, 2); assert.equal(response.data.history.buckets.length, 72);
  }
  assert.equal((await control()).checks, initial.checks, "stored refresh must not execute inference");
  console.log("PASS: configured models, ranges, aggregated timeline and read-only refresh");

  await control({ mode: "rate-limit" });
  const states = [];
  for (let index = 0; index < 3; index++) {
    const response = await check();
    assert.equal(response.status, 200); assert.equal(response.data.check.errorType, "RATE_LIMITED"); states.push(response.data.model.status);
    assert.doesNotMatch(JSON.stringify(response.data), /fixture-secret|sk-fixture-key/);
  }
  assert.deepEqual(states, ["HEALTHY", "DEGRADED", "DOWN"]);
  await control({ mode: "success" });
  assert.equal((await check()).data.model.status, "DOWN"); assert.equal((await check()).data.model.status, "HEALTHY");
  console.log("PASS: real inference, latency, failure/recovery thresholds and sanitized errors");

  await config({ enabled: true, intervalSeconds: 60, timeoutSeconds: 1, failureThreshold: 3, recoveryThreshold: 2, includeInRouting: false });
  const saved = await api(`/config?${new URLSearchParams({ modelId })}`);
  assert.equal(saved.data.config.enabled, true); assert.equal(saved.data.config.includeInRouting, false);
  await control({ delayMs: 1800 });
  assert.equal((await check()).data.check.errorType, "TIMEOUT");
  await control({ delayMs: 700 }); await config({ timeoutSeconds: 15 });
  const one = check();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await check()).status, 409);
  await one;
  console.log("PASS: persistent settings, cancellation and duplicate-check prevention");

  const batch = await fetch(`${base}/api/model-health/check-all`, { method: "POST" });
  const duplicate = await fetch(`${base}/api/model-health/check-all`, { method: "POST" });
  assert.equal(duplicate.status, 409);
  const events = (await batch.text()).trim().split("\n").map(JSON.parse);
  assert.equal(events[0].type, "start"); assert.equal(events.at(-1).type, "done");
  assert.equal(events.filter((event) => event.type === "result").length, 2);
  assert.ok((await control()).maxActive <= 3);
  console.log("PASS: streaming batch progress, batch lock and bounded concurrency");

  await config({ enabled: true }); await control({ delayMs: 50 });
  const beforeSchedule = (await control()).checks;
  await Promise.all([api("/run-scheduled", "POST"), api("/run-scheduled", "POST")]);
  assert.equal((await control()).checks, beforeSchedule + 1);
  await api("/run-scheduled", "POST");
  assert.equal((await control()).checks, beforeSchedule + 1);
  const detail = await api(`/model?${new URLSearchParams({ modelId, range: "3d" })}`);
  assert.ok(detail.data.recent.total >= 8); assert.ok(detail.data.model.p95LatencyMs > 0);
  assert.ok(detail.data.model.availability > 0 && detail.data.model.availability < 100);
  assert.doesNotMatch(JSON.stringify(detail.data), /fixture-secret|sk-fixture-key|fixture-placeholder|Authorization/);
  console.log("PASS: scheduled intervals/locking, persisted history, availability, p95 and safe API output");
} finally { await control({ mode: "success", delayMs: 100 }); await config({ enabled: false, intervalSeconds: 300, timeoutSeconds: 15, includeInRouting: true }); }
