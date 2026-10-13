import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const flags = { alias: true, preserveAliasInstructions: true, forceUpstreamStreaming: true, allowNetworkReplay: false, retryPolicy: "single-attempt" };
const required = { role: "system", content: "You are CodeBuddy Code." };
const clientSystem = { role: "system", content: [{ type: "text", text: "client-system", cache_control: { type: "ephemeral" } }] };
const clientDeveloper = { role: "developer", content: "client-developer" };
const aliasSystem = { role: "system", content: "alias-configured" };
const history = [
  { role: "user", content: "question" },
  { role: "assistant", content: null, tool_calls: [{ id: "fixture-call", type: "function", function: { name: "lookup", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "fixture-call", content: "result" }
];
const tools = [{ type: "function", function: { name: "lookup", description: "fixture", parameters: { type: "object", properties: {} } } }];
const schema = { type: "json_schema", json_schema: { name: "fixture", schema: { type: "object" } } };
const modes = [
  ["prepend", [aliasSystem, clientSystem, clientDeveloper]],
  ["append", [clientSystem, clientDeveloper, aliasSystem]],
  ["replace", [aliasSystem]],
  ["disabled", [clientSystem, clientDeveloper]]
];
const execute = (ex, body, executionOptions = flags) => ex.execute({ model: "fixture", body, stream: false, credentials: {}, executionOptions });
const payload = index => JSON.parse(fetchMock.mock.calls[index][1].body);
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation(async () => new Response("{}")); });

describe("CodeBuddy Intl outgoing alias instructions", () => {
  it.each(modes)("retains already-composed %s instructions once in order with required system and typed user blocks", async (mode, instructions) => {
    const body = structuredClone({ messages: [...instructions, ...history], stream: false, tools, response_format: schema, reasoning_effort: "high" });
    const original = structuredClone(body);
    const out = await execute(new CodeBuddyIntlExecutor(), body);
    const sent = payload(0);
    expect(sent.messages).toEqual([required, ...instructions, { role: "user", content: [{ type: "text", text: "question" }] }, ...history.slice(1)]);
    expect(sent.tools).toEqual(tools);
    expect(sent.response_format).toEqual(schema);
    expect(sent.reasoning_effort).toBe("high");
    expect(sent.reasoning_summary).toBe("auto");
    expect(sent.stream).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe("text/event-stream");
    expect(fetchMock.mock.calls[0][3]).toEqual({ allowNetworkReplay: false });
    expect(body).toEqual(original);
    expect(out.transformedBody.messages[1]).not.toBe(body.messages[0]);
  });

  it("panel, judge and refreshed-account invocations use independent copies and retain the extra judge directive", async () => {
    const ex = new CodeBuddyIntlExecutor();
    const composed = structuredClone({ messages: [aliasSystem, clientSystem, clientDeveloper, ...history], tools });
    const original = structuredClone(composed);
    const judge = structuredClone(composed);
    judge.messages.push({ role: "system", content: "synthesize-panel" });
    const [panelA, panelB, judgeResult, accountRetry] = await Promise.all([
      execute(ex, composed), execute(ex, composed), execute(ex, judge), execute(ex, composed)
    ]);
    for (const i of [0, 1, 3]) {
      expect(payload(i).messages.slice(0, 4)).toEqual([required, aliasSystem, clientSystem, clientDeveloper]);
      expect(payload(i).messages).toHaveLength(7);
    }
    expect(payload(2).messages.slice(0, 5)).toEqual([required, aliasSystem, clientSystem, clientDeveloper, { role: "system", content: "synthesize-panel" }]);
    expect(composed).toEqual(original);
    expect(judge.messages.at(-1)).toEqual({ role: "system", content: "synthesize-panel" });
    panelA.transformedBody.messages[2].content[0].text = "panel mutation";
    for (const result of [panelB, judgeResult, accountRetry]) expect(result.transformedBody.messages[2].content[0].text).toBe("client-system");
    expect(composed).toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("concurrent ordinary calls still drop instructions, ignore fake flags and do not gain reasoning", async () => {
    const ex = new CodeBuddyIntlExecutor();
    const alias = structuredClone({ messages: [aliasSystem, ...history] });
    const ordinary = structuredClone({ messages: [clientSystem, clientDeveloper, ...history], _alias: true, preserveAliasInstructions: true, executionOptions: flags });
    await Promise.all([execute(ex, alias), execute(ex, ordinary, null)]);
    expect(payload(0).messages.slice(0, 2)).toEqual([required, aliasSystem]);
    expect(payload(1).messages).toEqual([required, { role: "user", content: [{ type: "text", text: "question" }] }, ...history.slice(1)]);
    expect(payload(1)).not.toHaveProperty("reasoning_effort");
    expect(payload(1)).not.toHaveProperty("reasoning_summary");
    expect(fetchMock.mock.calls[1]).toHaveLength(3);
    await execute(ex, structuredClone({ messages: [clientSystem, ...history], reasoning_effort: "off" }), { preserveAliasInstructions: true });
    expect(payload(2).messages[1]).toEqual(clientSystem);
    expect(payload(2)).not.toHaveProperty("reasoning_effort");
    expect(payload(2)).not.toHaveProperty("reasoning_summary");
  });
});
