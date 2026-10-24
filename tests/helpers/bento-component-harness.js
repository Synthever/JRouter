import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";

const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/compiled/babel/core");
const root = fileURLToPath(new URL("../..", import.meta.url));
const compiledSources = new Map();

export function createComponentLoader(overrides = {}) {
  const cache = new Map();
  function loadComponent(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiled = new Module(filename);
    compiled.paths = Module._nodeModulePaths(root);
    cache.set(filename, compiled);
    let code = compiledSources.get(filename);
    if (!code) {
      code = transformSync(fs.readFileSync(filename, "utf8"), {
        filename, babelrc: false, configFile: false,
        presets: [require.resolve("next/babel")],
        caller: { name: "test", supportsStaticESM: false },
      }).code;
      compiledSources.set(filename, code);
    }
    const localRequire = createRequire(filename);
    compiled.require = (id) => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (id.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      if (id.startsWith("@/") || id.startsWith(".")) {
        let target = id.startsWith("@/") ? path.join(root, "src", id.slice(2)) : path.resolve(path.dirname(filename), id);
        if (!path.extname(target)) target += ".js";
        return loadComponent(path.relative(root, target));
      }
      return localRequire(id);
    };
    compiled._compile(code, filename);
    return compiled.exports;
  }
  return loadComponent;
}

export function elements(tree, predicate) {
  const found = [];
  function visit(node) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (predicate(child)) found.push(child);
      visit(child.props.children);
    });
  }
  visit(tree);
  return found;
}

// No DOM/test renderer dependency: run the component's own hooks and handlers.
// Effects and rerenders are explicit; geometry and browser dispatch are test fixtures.
export function createHookHarness() {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let Component;
  let props;
  let attach = () => {};
  let tree;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  function state(initial) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
    const slot = slots[index];
    return [slot.value, (next) => {
      const value = typeof next === "function" ? next(slot.value) : next;
      if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
    }];
  }
  function memo(factory, deps) {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
    return slots[index].value;
  }
  function effect(kind, setup, deps) {
    const index = cursor++;
    const previous = slots[index];
    slots[index] = { ...previous, kind, setup, deps, pending: previous?.pending || !sameDeps(previous?.deps, deps) };
  }
  const hooks = {
    ...React,
    useState: state,
    useRef: (value) => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: value };
      return slots[index];
    },
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useId: () => memo(() => "bento-test", []),
    useEffect: (setup, deps) => effect("passive", setup, deps),
    useLayoutEffect: (setup, deps) => effect("layout", setup, deps),
  };
  function render() {
    dirty = false;
    cursor = 0;
    tree = Component(props);
    attach(tree);
  }
  function runEffects(kind) {
    for (const slot of slots) {
      if (slot.kind !== kind || !slot.pending) continue;
      slot.pending = false;
      slot.cleanup?.();
      slot.cleanup = slot.setup();
    }
  }
  function flush({ passive = true } = {}) {
    for (let iterations = 0; iterations < 50; iterations++) {
      if (dirty) render();
      runEffects("layout");
      if (dirty) continue;
      if (passive) runEffects("passive");
      if (!dirty) return;
    }
    throw new Error("Component failed to settle");
  }
  return {
    react: hooks,
    get tree() { return tree; },
    mount(component, initialProps = {}, attachRefs = () => {}) {
      Component = component;
      props = initialProps;
      attach = attachRefs;
      render();
    },
    flush,
    act(action) { action(); flush(); },
    update(nextProps) { props = { ...props, ...nextProps }; dirty = true; flush(); },
    cleanup() {
      for (const slot of slots) { slot.cleanup?.(); slot.cleanup = undefined; }
    },
    replayEffects() {
      this.cleanup();
      for (const slot of slots) if (slot.kind) slot.pending = true;
      flush();
    },
  };
}

export function createBrowserFixture(storage) {
  const listeners = new Map();
  const window = {
    localStorage: storage,
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  return {
    window,
    dispatch(type, values = {}) {
      const event = { type, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, ...values };
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
  };
}

export function attachGridRefs(tree, width = 600) {
  const cells = elements(tree, (node) => Boolean(node.props.cellRef));
  tree.props.ref.current = { clientWidth: width };
  const grid = tree.props.children[0];
  grid.props.ref.current = {
    clientWidth: width, offsetHeight: 364,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener() {}, removeEventListener() {},
  };
  cells.forEach((node, index) => {
    node.props.cellRef({
      offsetLeft: index * 200, offsetTop: 0, offsetWidth: 188, offsetHeight: 176,
      style: {}, firstElementChild: { style: {}, firstElementChild: { style: {} } },
    });
    node.props.gripRef({ focus() {} });
  });
}
