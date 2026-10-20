// showListMenu gained extraActions and index/total for formatItem. Both are
// shared by apiKeys/combos/providers, so the offsets are pinned here: a wrong
// offset silently routes a selection to the wrong row.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Stub the renderer so the menu loop runs without a TTY.
const inputPath = require.resolve("../../cli/src/cli/utils/input.js");
let answers = [];
const labelsSeen = [];
require.cache[inputPath] = {
  id: inputPath,
  filename: inputPath,
  loaded: true,
  exports: {
    selectMenu: async (title, items) => {
      labelsSeen.push(items.map((i) => i.label));
      return answers.shift();
    },
    prompt: async () => "",
    confirm: async () => true,
    pause: async () => {},
    COLORS: {},
  },
};

const { showListMenu } = require("../../cli/src/cli/utils/menuHelper.js");

const items = [{ name: "one" }, { name: "two" }];

function baseConfig(overrides = {}) {
  return {
    title: "t",
    fetchItems: async () => ({ items }),
    formatItem: (item) => item.name,
    onSelect: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  answers = [];
  labelsSeen.length = 0;
});

describe("showListMenu offsets", () => {
  it("selects an item when there is no create action and no extras", async () => {
    const onSelect = vi.fn();
    answers = [2, 0]; // item index 1, then back
    await showListMenu(baseConfig({ onSelect }));
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it("keeps item offsets correct with a create action only", async () => {
    const onSelect = vi.fn();
    const createAction = { label: "Add", action: vi.fn() };
    answers = [1, 0]; // create, then back
    await showListMenu(baseConfig({ onSelect, createAction }));
    expect(createAction.action).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("runs an extra action without selecting a row", async () => {
    const onSelect = vi.fn();
    const extra = { label: "Batch", action: vi.fn() };
    answers = [1, 0]; // extra action is the first entry after Back
    await showListMenu(baseConfig({ onSelect, extraActions: [extra] }));
    expect(extra.action).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still reaches the first row when an extra action precedes the list", async () => {
    const onSelect = vi.fn();
    const extra = { label: "Batch", action: vi.fn() };
    answers = [2, 0]; // 0 back, 1 extra, 2 first row
    await showListMenu(baseConfig({ onSelect, extraActions: [extra] }));
    expect(extra.action).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("resolves all offsets with create action plus extras", async () => {
    const onSelect = vi.fn();
    const createAction = { label: "Add", action: vi.fn() };
    const extra = { label: "Batch", action: vi.fn() };

    answers = [1, 0];
    await showListMenu(baseConfig({ onSelect, createAction, extraActions: [extra] }));
    expect(createAction.action).toHaveBeenCalledTimes(1);

    answers = [2, 0];
    await showListMenu(baseConfig({ onSelect, createAction, extraActions: [extra] }));
    expect(extra.action).toHaveBeenCalledTimes(1);

    answers = [3, 0];
    await showListMenu(baseConfig({ onSelect, createAction, extraActions: [extra] }));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("passes index and total to formatItem", async () => {
    const seen = [];
    answers = [0];
    await showListMenu(baseConfig({
      formatItem: (item, index, total) => {
        seen.push([item.name, index, total]);
        return item.name;
      },
    }));
    expect(seen).toEqual([["one", 0, 2], ["two", 1, 2]]);
  });

  it("accepts a function label for extra actions", async () => {
    answers = [0];
    await showListMenu(baseConfig({
      extraActions: [{ label: () => "Dynamic", action: vi.fn() }],
    }));
    expect(labelsSeen[0]).toContain("Dynamic");
  });

  it("returns on Back without selecting anything", async () => {
    const onSelect = vi.fn();
    answers = [0];
    await showListMenu(baseConfig({ onSelect }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
