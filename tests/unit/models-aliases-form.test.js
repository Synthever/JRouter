import { describe, expect, it } from "vitest";
import { createAliasDraft, validateAliasDraft, orderedDraftMembers, removeDraftMember, moveDraftMember, memberObservability } from "@/app/(dashboard)/dashboard/models-aliases/components/modelAliasForm.js";

const base = () => ({ ...createAliasDraft(), name: "Nested/Case", models: ["cp/One", "cbai/Two", "cp/Three"], primaryModel: "cbai/Two" });
describe("Models Alias draft configuration", () => {
  it("initializes the create form's explicit null alias without crashing", () => {
    expect(createAliasDraft(null)).toEqual(createAliasDraft());
  });
  it("requires explicit primary and judge replacement after removal without ghost members", () => {
    const draft = { ...base(), judgeModel: "cbai/Two" };
    const removed = removeDraftMember(draft, "cbai/Two");
    expect(removed.primaryModel).toBe("cbai/Two");
    expect(removed.judgeModel).toBe("cbai/Two");
    expect(orderedDraftMembers(removed)).toEqual(["cp/One", "cp/Three"]);
    expect(validateAliasDraft(removed).errors).toMatchObject({ primaryModel: expect.any(String), judgeModel: expect.any(String) });
    expect(validateAliasDraft({ ...removed, primaryModel: "cp/One", judgeModel: null }).valid).toBe(true);
    expect(draft.models).toHaveLength(3);
  });
  it("pins primary and permits only deliberate non-primary reordering", () => {
    const draft = base();
    expect(orderedDraftMembers(draft)).toEqual(["cbai/Two", "cp/One", "cp/Three"]);
    expect(orderedDraftMembers(moveDraftMember(draft, "cp/Three", -1))).toEqual(["cbai/Two", "cp/Three", "cp/One"]);
    expect(moveDraftMember(draft, "cp/One", -1)).toEqual(draft);
    expect(moveDraftMember(draft, "cbai/Two", 1)).toEqual(draft);
  });
  it.each(["", " ", "0", "-1", "NaN", "Infinity", "0x10", "true", "0.0001", "2147483.648"])("rejects unrepresentable deadline %s", value => {
    expect(validateAliasDraft({ ...base(), initialResponseTimeoutSeconds: value }).errors.initialResponseTimeoutSeconds).toBeTruthy();
  });
  it.each(["0.001", "15.25", "2147483.647"])("accepts decimal deadline %s within shared timer range", value => {
    const result = validateAliasDraft({ ...base(), initialResponseTimeoutSeconds: value });
    expect(result.valid).toBe(true);
    expect(result.config.initialResponseTimeoutSeconds).toBe(Number(value));
    expect(result.config.name).toBe("Nested/Case");
    expect(result.config.judgeModel).toBeNull();
  });
  it.each(["fallback", "round-robin", "fusion"])("normalizes strategy %s through shared rules", strategy => {
    expect(validateAliasDraft({ ...base(), strategy }).config.strategy).toBe(strategy);
  });
  it("reports invalid names, virtual members and empty membership without defaulting them", () => {
    expect(validateAliasDraft({ ...base(), name: "jrouter/Case" }).errors.name).toBeTruthy();
    expect(validateAliasDraft({ ...base(), models: ["jrouter/Other"] }).errors.models).toBeTruthy();
    expect(validateAliasDraft({ ...base(), models: [] }).errors.models).toBeTruthy();
  });
  it("uses exact friendly metadata prefixes and leaves unknown observability unknown", () => {
    expect(memberObservability("cmc/Nested/Case", { cmc: { outputObservability: "buffered" } })).toBe("buffered");
    expect(memberObservability("unconfigured/gpt-4o", {})).toBe("unknown");
  });
});
