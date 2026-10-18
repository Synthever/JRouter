// Live OAuth kickoff verification for the workbuddy release: GET device-code
// through production must open a session on www.workbuddy.ai.
import { describe, expect, it } from "vitest";
import { getConsistentMachineId } from "@/shared/utils/machineId.js";

describe("workbuddy live oauth kickoff", () => {
  it("starts a device-code session against www.workbuddy.ai", async () => {
    const cliToken = await getConsistentMachineId("9r-cli-auth");
    const res = await fetch("http://127.0.0.1:20128/api/oauth/workbuddy/device-code", {
      method: "GET",
      headers: { "x-9r-cli-token": cliToken },
    });
    const j = await res.json().catch(() => ({}));
    expect(res.status).toBe(200);
    expect(j.device_code).toBeTruthy();
    expect(new URL(j.verification_uri).host).toBe("www.workbuddy.ai");
    expect(j.verification_uri).toContain("platform=workbuddy");
  });
});
