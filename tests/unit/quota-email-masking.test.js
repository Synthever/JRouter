import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getConnectionLabel,
  maskQuotaEmail,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Quota Tracker email masking", () => {
  it.each([
    ["alice@example.com", "a***@example.com"],
    ["a@example.com", "a***@example.com"],
    ["alice+quota@example.co.id", "a***@example.co.id"],
    ["Work account", "Work account"],
    ["", ""],
    [null, null],
    [undefined, undefined],
  ])("masks %s without changing non-email labels", (label, expected) => {
    expect(maskQuotaEmail(label)).toBe(expected);
  });

  it("only masks display text, preserving the connection and its original label", () => {
    const connection = { name: "alice@example.com", email: "alice@example.com" };

    expect(maskQuotaEmail(getConnectionLabel(connection))).toBe("a***@example.com");
    expect(getConnectionLabel(connection)).toBe("alice@example.com");
    expect(connection.email).toBe("alice@example.com");
  });

  it("masks both account label lines rendered in the quota cards", () => {
    const source = readFileSync(new URL(
      "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js",
      import.meta.url,
    ), "utf8");

    expect(source.includes("{maskQuotaEmail(getConnectionLabel(conn))}")).toBe(true);
    expect(source.includes("{maskQuotaEmail(getConnectionSecondaryLabel(conn))}")).toBe(true);
  });
});