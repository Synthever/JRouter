// Providers TUI helpers: status rendering, ordering and priority math.
// These decide what the operator sees about a connection, so the cases pin
// behaviour rather than formatting details.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  connectionStatus,
  connectionLabel,
  sortConnections,
  planPriorityMove,
  summariseBatch,
  STATUS_STYLE,
} = require("../../cli/src/cli/utils/providerView.js");

describe("connection status", () => {
  it("maps the four server statuses to distinct markers", () => {
    expect(connectionStatus({ testStatus: "active" }).mark).toBe("✓");
    expect(connectionStatus({ testStatus: "unavailable" }).mark).toBe("✗");
    expect(connectionStatus({ testStatus: "error" }).mark).toBe("✗");
    expect(connectionStatus({ testStatus: "unknown" }).mark).toBe("?");
  });

  it("reports a demoted connection as demoted, not as an error", () => {
    const status = connectionStatus({ testStatus: "active", demotedAt: "2026-10-20T00:00:00Z" });
    expect(status.demoted).toBe(true);
    expect(status.mark).toBe("⇣");
  });

  it("falls back to unknown for a status the server has not sent before", () => {
    expect(connectionStatus({ testStatus: "quarantined" }).mark).toBe("?");
    expect(connectionStatus({}).mark).toBe("?");
    expect(connectionStatus(null).mark).toBe("?");
  });
});

describe("connection label", () => {
  it("shows position, status and priority", () => {
    const label = connectionLabel({ name: "acme", testStatus: "active", priority: 3 }, 2, 18);
    expect(label).toContain(" 2/18");
    expect(label).toContain("acme");
    expect(label).toContain("✓");
    expect(label).toContain("p3");
  });

  it("marks a disabled connection", () => {
    const label = connectionLabel({ email: "a@b.c", isActive: false, testStatus: "active" }, 1, 1);
    expect(label).toContain("[off]");
    expect(label).not.toContain("/"); // no position counter when there is one row
  });

  it("falls back to the email when a connection has no name", () => {
    expect(connectionLabel({ email: "x@y.z" }, 1, 4)).toContain("x@y.z");
  });
});

describe("connection ordering", () => {
  it("sorts enabled before disabled, by priority, demoted last", () => {
    const list = [
      { id: "demoted", isActive: true, demotedAt: "2026-01-01", priority: 1 },
      { id: "off", isActive: false, priority: 0 },
      { id: "second", isActive: true, priority: 2 },
      { id: "first", isActive: true, priority: 1 },
    ];
    expect(sortConnections(list).map((c) => c.id)).toEqual(["first", "second", "demoted", "off"]);
  });

  it("treats a missing priority as last among enabled connections", () => {
    const list = [{ id: "nopri" }, { id: "haspri", priority: 5 }];
    expect(sortConnections(list).map((c) => c.id)).toEqual(["haspri", "nopri"]);
  });

  it("does not mutate the input array", () => {
    const list = [{ id: "b", priority: 2 }, { id: "a", priority: 1 }];
    const copy = [...list];
    sortConnections(list);
    expect(list).toEqual(copy);
  });
});

describe("priority move planning", () => {
  const list = [
    { id: "a", priority: 1 },
    { id: "b", priority: 2 },
    { id: "c", priority: 3 },
  ];

  it("moves an item up by swapping it with its neighbour", () => {
    const changes = planPriorityMove(list, "b", -1);
    const byId = Object.fromEntries(changes.map((c) => [c.id, c.priority]));
    expect(byId.a).toBe(2);
    expect(byId.b).toBe(1);
  });

  it("moves an item down", () => {
    const changes = planPriorityMove(list, "a", 1);
    const byId = Object.fromEntries(changes.map((c) => [c.id, c.priority]));
    expect(byId.a).toBe(2);
    expect(byId.b).toBe(1);
  });

  it("returns nothing at the boundaries", () => {
    expect(planPriorityMove(list, "a", -1)).toEqual([]);
    expect(planPriorityMove(list, "c", 1)).toEqual([]);
  });

  it("returns nothing for an unknown id", () => {
    expect(planPriorityMove(list, "nope", 1)).toEqual([]);
  });

  it("keeps priorities unique after a move", () => {
    const changes = planPriorityMove(list, "c", -1);
    const priorities = changes.map((c) => c.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});

describe("batch test summary", () => {
  it("counts passes and lists failures with their status code", () => {
    const summary = summariseBatch({
      results: [
        { connectionName: "ok-1", valid: true },
        { connectionName: "ok-2", valid: true },
        { connectionName: "bad", valid: false, error: "401 unauthorized", statusCode: 401 },
      ],
    });
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toEqual([{ name: "bad", error: "401 unauthorized", statusCode: 401 }]);
  });

  it("survives an empty or malformed response", () => {
    expect(summariseBatch({}).total).toBe(0);
    expect(summariseBatch(null).failed).toBe(0);
  });

  it("names a failure that arrived without a connection name", () => {
    const summary = summariseBatch({ results: [{ connectionId: "abc", valid: false }] });
    expect(summary.failures[0].name).toBe("abc");
    expect(summary.failures[0].error).toBe("unknown error");
  });
});

describe("status table", () => {
  it("marks failures consistently and keeps unknown distinct", () => {
    // unavailable and error are both failures, so sharing ✗ is intentional.
    expect(STATUS_STYLE.unavailable.mark).toBe(STATUS_STYLE.error.mark);
    expect(STATUS_STYLE.active.mark).not.toBe(STATUS_STYLE.unknown.mark);
    expect(STATUS_STYLE.unknown.mark).not.toBe(STATUS_STYLE.error.mark);
  });
});
