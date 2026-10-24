"use client";

/**
 * @author: @dorianbaffier
 * @description: Widget Grid, adapted to JavaScript and JRouter theme tokens.
 * @version: 3.0.0
 * @date: 2026-10-14
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 */

import { GripVertical } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";
import styles from "./bento-grid.module.css";

const COLUMNS = 6;
const NARROW_COLUMNS = 2;
const MIN_SPAN = 2;
const GAP = 12;
const NARROW_BELOW = 576;
const LONG_PRESS_MS = 350;
const PRESS_SLOP = 8;
const LIFT_Z = 18;
const MAX_TILT = 7;
const SIZE_LABEL = { s: "small", m: "medium", l: "large" };
const EMPTY_ITEMS = [];

function clampSpan(span, fallback = MIN_SPAN) {
  const value = Number.isFinite(span) ? span : Number.isFinite(fallback) ? fallback : MIN_SPAN;
  return Math.min(COLUMNS, Math.max(MIN_SPAN, Math.round(value)));
}

/** Maps a six-column span to the widget's responsive content size. */
export function sizeForSpan(span, narrow = false) {
  const width = clampSpan(span);
  if (narrow) return width <= MIN_SPAN ? "s" : "m";
  return width <= 2 ? "s" : width <= 4 ? "m" : "l";
}

function narrowSpan(span, columns = NARROW_COLUMNS) {
  return columns === 1 || span <= MIN_SPAN ? 1 : 2;
}

/** Keeps known IDs once, restores missing widgets, and bounds untrusted spans. */
export function normalizeLayout(layout, items = EMPTY_ITEMS) {
  const known = new Map();
  for (const item of Array.isArray(items) ? items : EMPTY_ITEMS) {
    if (item && typeof item.id === "string" && !known.has(item.id)) known.set(item.id, item);
  }
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(layout) ? layout : EMPTY_ITEMS) {
    if (!entry || !known.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, span: clampSpan(entry.span, known.get(entry.id).defaultSpan) });
  }
  for (const [id, item] of known) {
    if (!seen.has(id)) out.push({ id, span: clampSpan(item.defaultSpan) });
  }
  return out;
}

function moveItem(list, from, to) {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function contains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

const spring = (k, zeta) => ({ k, c: 2 * Math.sqrt(k) * zeta });
const MOVE_SPRING = spring(420, 0.76);
const LIFT_SPRING = spring(520, 0.82);
const TILT_SPRING = spring(260, 0.6);
const STEP = 1 / 120;

function createBody() {
  return {
    ox: 0, oy: 0, vx: 0, vy: 0,
    sx: 1, sy: 1, vsx: 0, vsy: 0,
    lift: 0, vlift: 0, liftTarget: 0,
    rx: 0, ry: 0, vrx: 0, vry: 0,
    pvx: 0, pvy: 0, hold: 0, pinned: false,
  };
}

function integrate(x, v, target, cfg, dt) {
  const a = -cfg.k * (x - target) - cfg.c * v;
  const nextVelocity = v + a * dt;
  return [x + nextVelocity * dt, nextVelocity];
}

const clampTilt = (v) => Math.max(-MAX_TILT, Math.min(MAX_TILT, v));

function stepBody(b, dt) {
  const tiltY = b.pinned ? clampTilt(b.pvx * 9) : 0;
  const tiltX = b.pinned ? clampTilt(-b.pvy * 9) : 0;
  [b.ry, b.vry] = integrate(b.ry, b.vry, tiltY, TILT_SPRING, dt);
  [b.rx, b.vrx] = integrate(b.rx, b.vrx, tiltX, TILT_SPRING, dt);
  [b.lift, b.vlift] = integrate(b.lift, b.vlift, b.liftTarget, LIFT_SPRING, dt);
  b.pvx *= Math.exp(-dt * 10);
  b.pvy *= Math.exp(-dt * 10);
  if (b.hold > 0) {
    b.hold -= dt;
    return;
  }
  if (!b.pinned) {
    [b.ox, b.vx] = integrate(b.ox, b.vx, 0, MOVE_SPRING, dt);
    [b.oy, b.vy] = integrate(b.oy, b.vy, 0, MOVE_SPRING, dt);
  }
  [b.sx, b.vsx] = integrate(b.sx, b.vsx, 1, MOVE_SPRING, dt);
  [b.sy, b.vsy] = integrate(b.sy, b.vsy, 1, MOVE_SPRING, dt);
}

const near = (x, v, target, eps) => Math.abs(x - target) < eps && Math.abs(v) < eps * 10;

function isSettled(b) {
  if (b.pinned || b.hold > 0) return false;
  return near(b.ox, b.vx, 0, 0.2) && near(b.oy, b.vy, 0, 0.2)
    && near(b.sx, b.vsx, 1, 0.001) && near(b.sy, b.vsy, 1, 0.001)
    && near(b.lift, b.vlift, b.liftTarget, 0.002)
    && near(b.rx, b.vrx, 0, 0.02) && near(b.ry, b.vry, 0, 0.02);
}

function snapBody(b, reduced = false) {
  if (!b.pinned) { b.ox = 0; b.oy = 0; }
  Object.assign(b, {
    vx: 0, vy: 0, sx: 1, sy: 1, vsx: 0, vsy: 0,
    lift: reduced ? 0 : b.liftTarget, vlift: 0,
    rx: 0, ry: 0, vrx: 0, vry: 0, hold: 0,
  });
}

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

// Spring transforms bypass React; the frame loop sleeps once every cell settles.
class GridEngine {
  bodies = new Map();
  els = new Map();
  reduced = false;
  raf = 0;
  last = 0;

  body(id) {
    let b = this.bodies.get(id);
    if (!b) { b = createBody(); this.bodies.set(id, b); }
    return b;
  }

  kick() {
    if (this.raf || typeof window === "undefined") return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setReduced(reduced) {
    this.reduced = reduced;
    this.kick();
  }

  write(id, b) {
    const el = this.els.get(id);
    if (!el) return;
    const surface = el.firstElementChild;
    const shadow = surface?.firstElementChild;
    const lift = this.reduced ? 0 : b.lift;
    const rx = this.reduced ? 0 : b.rx;
    const ry = this.reduced ? 0 : b.ry;
    const atRest = b.ox === 0 && b.oy === 0 && lift === 0 && rx === 0 && ry === 0;
    el.style.transform = atRest ? ""
      : `translate3d(${r2(b.ox)}px, ${r2(b.oy)}px, ${r2(lift * LIFT_Z)}px) rotateX(${r2(rx)}deg) rotateY(${r2(ry)}deg)`;
    if (surface) surface.style.transform = this.reduced || (b.sx === 1 && b.sy === 1)
      ? "" : `scale(${r3(b.sx)}, ${r3(b.sy)})`;
    if (shadow) shadow.style.opacity = String(r2(Math.max(0, Math.min(1, lift))));
  }

  advance(b, elapsed) {
    if (this.reduced) { snapBody(b, true); return false; }
    let t = elapsed;
    while (t > 0) {
      const dt = Math.min(STEP, t);
      stepBody(b, dt);
      t -= dt;
    }
    if (isSettled(b)) { snapBody(b); return false; }
    return true;
  }

  tick = (now) => {
    const elapsed = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let active = false;
    for (const [id, b] of this.bodies) {
      active = this.advance(b, elapsed) || active;
      this.write(id, b);
    }
    this.raf = active ? requestAnimationFrame(this.tick) : 0;
  };
}

function WidgetCell({
  item, span, narrow, narrowColumns, lifted, resizing, reducedMotion, instructionsId,
  cellRef, gripRef, onPressStart, onGripPointerDown, onGripKeyDown,
  onGripBlur, onResizePointerDown, onResizeKeyDown,
}) {
  const size = sizeForSpan(span, narrow);
  const columns = narrow ? narrowColumns : COLUMNS;
  const shownSpan = narrow ? narrowSpan(span, narrowColumns) : span;

  return (
    <div
      className={styles.cell}
      data-widget-id={item.id}
      data-lifted={lifted || undefined}
      data-resizing={resizing || undefined}
      onContextMenu={(e) => {
        if (lifted || e.nativeEvent.pointerType === "touch") e.preventDefault();
      }}
      onPointerDown={onPressStart}
      ref={cellRef}
      style={{ "--span": span, "--span-n": narrowSpan(span, narrowColumns) }}
    >
      <div className={styles.surface}>
        <div className={styles.liftShadow} />
      </div>
      <div className={styles.content}>
        <div className={styles.header}>
          {item.icon ? <span aria-hidden="true" className={styles.icon}>{item.icon}</span> : null}
          <span className={styles.title} title={item.title}>{item.title}</span>
          <button
            aria-describedby={instructionsId}
            aria-label={`Move ${item.title} (${SIZE_LABEL[size]})`}
            aria-pressed={lifted}
            className={styles.grip}
            data-no-press
            onBlur={onGripBlur}
            onKeyDown={onGripKeyDown}
            onPointerDown={onGripPointerDown}
            ref={gripRef}
            type="button"
          >
            <GripVertical aria-hidden="true" size={16} />
          </button>
        </div>
        <div className={styles.body}>
          <AnimatePresence initial={false}>
            <motion.div
              animate={{ opacity: 1 }}
              className={styles.widget}
              exit={{ opacity: 0 }}
              initial={reducedMotion ? false : { opacity: 0 }}
              key={size}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
            >
              {item.render(size)}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      {(!narrow || narrowColumns > 1) && <button
        aria-describedby={instructionsId}
        aria-label={`Resize ${item.title}, ${shownSpan} of ${columns} columns`}
        className={styles.resize}
        data-no-press
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizePointerDown}
        type="button"
      >
        <svg aria-hidden="true" width="12" height="12" fill="none" viewBox="0 0 10 10">
          <circle cx="8.5" cy="3.5" fill="currentColor" r="1.1" />
          <circle cx="6" cy="6" fill="currentColor" r="1.1" />
          <circle cx="3.5" cy="8.5" fill="currentColor" r="1.1" />
        </svg>
      </button>}
    </div>
  );
}

/**
 * items: { id, title, icon?, defaultSpan?, render(size) }[]
 * layout/defaultLayout: { id, span: 2..6 }[]; onLayoutChange previews each change.
 * onLayoutCommit receives accepted drops and resizes, never cancellation or cleanup.
 */
export default function WidgetGrid({
  items = EMPTY_ITEMS, layout, defaultLayout, onLayoutChange, onLayoutCommit, className, rowHeight = 176,
  narrowColumns = NARROW_COLUMNS,
}) {
  const instructionsId = useId();
  const reducedMotion = useReducedMotion();
  const [engine] = useState(() => new GridEngine());
  const [innerLayout, setInnerLayout] = useState(() => normalizeLayout(defaultLayout, items));
  const current = useMemo(() => normalizeLayout(layout ?? innerLayout, items), [layout, innerLayout, items]);
  const itemsById = useMemo(() => new Map((Array.isArray(items) ? items : EMPTY_ITEMS)
    .filter((item) => item && typeof item.id === "string")
    .map((item) => [item.id, item])), [items]);
  const [narrow, setNarrow] = useState(false);
  const [liftedId, setLiftedId] = useState(null);
  const [resizingId, setResizingId] = useState(null);
  const [message, setMessage] = useState("");
  const [slotRows, setSlotRows] = useState(0);
  const wrapRef = useRef(null);
  const gridRef = useRef(null);
  const rectsRef = useRef(new Map());
  const gripsRef = useRef(new Map());
  const pendingFlipRef = useRef(null);
  const dragRef = useRef(null);
  const pressRef = useRef(null);
  const resizeRef = useRef(null);
  const reorderingRef = useRef(false);
  const narrowRef = useRef(false);
  const layoutRef = useRef(current);
  const latest = useRef({ layout, onLayoutChange, onLayoutCommit, itemsById });
  const cancelPressRef = useRef(() => {});
  const endDragRef = useRef(() => {});
  const endResizeRef = useRef(() => {});

  useLayoutEffect(() => {
    latest.current = { layout, onLayoutChange, onLayoutCommit, itemsById };
    layoutRef.current = current;
  }, [layout, onLayoutChange, onLayoutCommit, itemsById, current]);

  const titleOf = useCallback((id) => latest.current.itemsById.get(id)?.title ?? id, []);
  const announce = useCallback((text) => {
    setMessage((prev) => prev === text ? `${text} ` : text);
  }, []);
  const positionText = useCallback((id) => {
    const list = layoutRef.current;
    return `position ${list.findIndex((entry) => entry.id === id) + 1} of ${list.length}`;
  }, []);
  const preview = useCallback((next, movedId) => {
    pendingFlipRef.current = { prev: new Map(rectsRef.current), movedId };
    layoutRef.current = next;
    if (latest.current.layout === undefined) setInnerLayout(next);
    latest.current.onLayoutChange?.(next);
  }, []);

  // offset* ignore transforms, so hit testing always uses resting slots.
  const measure = useCallback(() => {
    const next = new Map();
    for (const [id, el] of engine.els) {
      next.set(id, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    }
    rectsRef.current = next;
    return next;
  }, [engine]);
  const toGrid = useCallback((clientX, clientY) => {
    const box = gridRef.current?.getBoundingClientRect();
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
  }, []);
  const placeDragged = useCallback(() => {
    const drag = dragRef.current;
    const rect = drag ? rectsRef.current.get(drag.id) : undefined;
    if (!drag || !rect || drag.mode !== "pointer") return;
    const point = toGrid(drag.lastX, drag.lastY);
    const body = engine.body(drag.id);
    body.ox = point.x - drag.grabX - rect.x;
    body.oy = point.y - drag.grabY - rect.y;
    engine.write(drag.id, body);
    engine.kick();
  }, [engine, toGrid]);
  const flip = useCallback((prev, next, movedId) => {
    const origin = next.get(movedId);
    const cx = origin ? origin.x + origin.w / 2 : 0;
    const cy = origin ? origin.y + origin.h / 2 : 0;
    const pinnedId = dragRef.current?.mode === "pointer" ? dragRef.current.id : null;
    for (const [id, rect] of next) {
      const old = prev.get(id);
      if (!old || id === pinnedId || !rect.w || !rect.h) continue;
      const body = engine.body(id);
      const moved = Math.abs(old.x - rect.x) > 0.5 || Math.abs(old.y - rect.y) > 0.5 || old.w !== rect.w;
      body.ox += old.x - rect.x;
      body.oy += old.y - rect.y;
      body.sx = old.w * body.sx / rect.w;
      body.sy = old.h * body.sy / rect.h;
      if (moved && id !== movedId) {
        const distance = Math.hypot(rect.x + rect.w / 2 - cx, rect.y + rect.h / 2 - cy);
        body.hold = Math.min(0.1, distance * 0.00016);
      }
      if (engine.reduced) snapBody(body, true);
      engine.write(id, body);
    }
    engine.kick();
  }, [engine]);

  useLayoutEffect(() => {
    const next = measure();
    const pending = pendingFlipRef.current;
    pendingFlipRef.current = null;
    if (pending) flip(pending.prev, next, pending.movedId);
    placeDragged();
    const drag = dragRef.current;
    if (drag?.mode === "keyboard") {
      const grip = gripsRef.current.get(drag.id);
      if (grip && document.activeElement !== grip) grip.focus({ preventScroll: true });
    }
    reorderingRef.current = false;
  }, [current, narrow, measure, flip, placeDragged]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const sync = () => {
      const isNarrow = wrap.clientWidth < NARROW_BELOW;
      narrowRef.current = isNarrow;
      setNarrow(isNarrow);
      measure();
      placeDragged();
    };
    const observer = new ResizeObserver(sync);
    observer.observe(wrap);
    sync();
    return () => observer.disconnect();
  }, [measure, placeDragged]);
  useEffect(() => {
    engine.setReduced(Boolean(reducedMotion));
  }, [engine, reducedMotion]);

  const hitTest = useCallback((x, y) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.skipId) {
      const rect = rectsRef.current.get(drag.skipId);
      if (rect && contains(rect, x, y)) return;
      drag.skipId = null;
    }
    const list = layoutRef.current;
    const from = list.findIndex((entry) => entry.id === drag.id);
    const to = list.findIndex((entry) => {
      const rect = rectsRef.current.get(entry.id);
      return entry.id !== drag.id && rect && contains(rect, x, y);
    });
    if (from < 0 || to < 0) return;
    drag.skipId = list[to].id;
    preview(moveItem(list, from, to), drag.id);
    announce(`${titleOf(drag.id)} moved to position ${to + 1} of ${list.length}.`);
  }, [announce, preview, titleOf]);
  const onDragMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.mode !== "pointer" || event.pointerId !== drag.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastT);
    const body = engine.body(drag.id);
    body.pvx += ((event.clientX - drag.lastX) / elapsed - body.pvx) * 0.35;
    body.pvy += ((event.clientY - drag.lastY) / elapsed - body.pvy) * 0.35;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastT = now;
    placeDragged();
    const point = toGrid(event.clientX, event.clientY);
    hitTest(point.x, point.y);
  }, [engine, hitTest, placeDragged, toGrid]);
  const onDragUp = useCallback((event) => {
    if (event.pointerId === dragRef.current?.pointerId) endDragRef.current(event.type === "pointercancel");
  }, []);
  const onDragKey = useCallback((event) => {
    if (event.key === "Escape") { event.preventDefault(); endDragRef.current(true); }
  }, []);
  const removeDragListeners = useCallback(() => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragUp);
    window.removeEventListener("pointercancel", onDragUp);
    window.removeEventListener("keydown", onDragKey);
  }, [onDragKey, onDragMove, onDragUp]);
  const endDrag = useCallback((cancel) => {
    const drag = dragRef.current;
    if (!drag) return;
    removeDragListeners();
    const body = engine.body(drag.id);
    if (drag.mode === "pointer") { body.vx = body.pvx * 400; body.vy = body.pvy * 400; }
    body.pinned = false;
    body.liftTarget = 0;
    dragRef.current = null;
    if (cancel) preview(drag.snapshot, drag.id);
    else latest.current.onLayoutCommit?.(layoutRef.current);
    engine.kick();
    setLiftedId(null);
    if (cancel) {
      const index = drag.snapshot.findIndex((entry) => entry.id === drag.id);
      announce(`Move cancelled. ${titleOf(drag.id)} returned to position ${index + 1} of ${drag.snapshot.length}.`);
    } else announce(`${titleOf(drag.id)} dropped at ${positionText(drag.id)}.`);
  }, [announce, preview, engine, positionText, removeDragListeners, titleOf]);
  useLayoutEffect(() => { endDragRef.current = endDrag; }, [endDrag]);

  const liftPointer = useCallback((id, pointerId, clientX, clientY) => {
    const rect = rectsRef.current.get(id);
    if (!rect || dragRef.current || resizeRef.current) return;
    const body = engine.body(id);
    const point = toGrid(clientX, clientY);
    dragRef.current = {
      id, mode: "pointer", pointerId,
      grabX: point.x - (rect.x + body.ox), grabY: point.y - (rect.y + body.oy),
      lastX: clientX, lastY: clientY, lastT: performance.now(),
      skipId: null, snapshot: layoutRef.current,
    };
    Object.assign(body, { pinned: true, hold: 0, vx: 0, vy: 0, pvx: 0, pvy: 0, liftTarget: 1 });
    engine.kick();
    setLiftedId(id);
    announce(`${titleOf(id)} lifted, ${positionText(id)}.`);
    navigator.vibrate?.(8);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp);
    window.addEventListener("pointercancel", onDragUp);
    window.addEventListener("keydown", onDragKey);
  }, [announce, engine, onDragKey, onDragMove, onDragUp, positionText, titleOf, toGrid]);

  const onPressMove = useCallback((event) => {
    const press = pressRef.current;
    if (!press || event.pointerId !== press.pointerId) return;
    press.x = event.clientX;
    press.y = event.clientY;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > PRESS_SLOP) cancelPressRef.current();
  }, []);
  const onPressEnd = useCallback((event) => {
    if (event.pointerId === pressRef.current?.pointerId) cancelPressRef.current();
  }, []);
  const cancelPress = useCallback(() => {
    const press = pressRef.current;
    if (press) window.clearTimeout(press.timer);
    pressRef.current = null;
    window.removeEventListener("pointermove", onPressMove);
    window.removeEventListener("pointerup", onPressEnd);
    window.removeEventListener("pointercancel", onPressEnd);
  }, [onPressEnd, onPressMove]);
  useLayoutEffect(() => { cancelPressRef.current = cancelPress; }, [cancelPress]);
  const startPress = useCallback((event, id) => {
    const target = event.target;
    if (dragRef.current || resizeRef.current || pressRef.current || event.button !== 0
      || target.closest("[data-no-press], a, button, input, textarea, select, [role='button'], [contenteditable]:not([contenteditable='false'])")) return;
    pressRef.current = {
      id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY,
      timer: window.setTimeout(() => {
        const press = pressRef.current;
        cancelPressRef.current();
        if (press) liftPointer(press.id, press.pointerId, press.x, press.y);
      }, LONG_PRESS_MS),
    };
    window.addEventListener("pointermove", onPressMove);
    window.addEventListener("pointerup", onPressEnd);
    window.addEventListener("pointercancel", onPressEnd);
  }, [liftPointer, onPressEnd, onPressMove]);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const block = (event) => {
      if (dragRef.current?.mode === "pointer" || resizeRef.current) event.preventDefault();
    };
    grid.addEventListener("touchmove", block, { passive: false });
    return () => grid.removeEventListener("touchmove", block);
  }, []);

  const spanText = useCallback((span) => {
    const isNarrow = narrowRef.current;
    return `${isNarrow ? narrowSpan(span, narrowColumns) : span} of ${isNarrow ? narrowColumns : COLUMNS} columns, ${SIZE_LABEL[sizeForSpan(span, isNarrow)]}`;
  }, [narrowColumns]);
  const applySpan = useCallback((id, span) => {
    const list = layoutRef.current;
    const entry = list.find((item) => item.id === id);
    if (!entry || entry.span === span) return false;
    preview(list.map((item) => item.id === id ? { ...item, span } : item), id);
    announce(`${titleOf(id)} resized to ${spanText(span)}.`);
    return true;
  }, [announce, preview, spanText, titleOf]);
  const spanFromPointer = useCallback((clientX) => {
    const start = resizeRef.current;
    const grid = gridRef.current;
    if (!start || !grid) return null;
    const isNarrow = narrowRef.current;
    const columns = isNarrow ? narrowColumns : COLUMNS;
    if (isNarrow && narrowColumns === 1) return start.span;
    const columnWidth = (grid.clientWidth + GAP) / columns;
    const steps = Math.round((clientX - start.x) / columnWidth);
    if (!isNarrow) return clampSpan(start.span + steps);
    const shownSpan = Math.max(1, Math.min(2, narrowSpan(start.span) + steps));
    return shownSpan === 1 ? MIN_SPAN : Math.max(3, start.span);
  }, [narrowColumns]);
  const onResizeMove = useCallback((event) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const span = spanFromPointer(event.clientX);
    if (span !== null) applySpan(resize.id, span);
  }, [applySpan, spanFromPointer]);
  const onResizeKey = useCallback((event) => {
    if (event.key !== "Escape" || !resizeRef.current) return;
    event.preventDefault();
    endResizeRef.current(event);
  }, []);
  const removeResizeListeners = useCallback(() => {
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", endResizeRef.current);
    window.removeEventListener("pointercancel", endResizeRef.current);
    window.removeEventListener("keydown", onResizeKey);
  }, [onResizeKey, onResizeMove]);
  const onResizeUp = useCallback((event) => {
    const resize = resizeRef.current;
    if (!resize || (event?.key !== "Escape" && event?.pointerId !== resize.pointerId)) return;
    resizeRef.current = null;
    removeResizeListeners();
    setResizingId(null);
    if (event.type === "pointercancel" || event.key === "Escape") preview(resize.snapshot, resize.id);
    else latest.current.onLayoutCommit?.(layoutRef.current);
  }, [preview, removeResizeListeners]);
  useLayoutEffect(() => { endResizeRef.current = onResizeUp; }, [onResizeUp]);
  const startResize = useCallback((event, id) => {
    if (dragRef.current || resizeRef.current || event.button !== 0) return;
    event.preventDefault();
    cancelPress();
    resizeRef.current = {
      id, pointerId: event.pointerId, x: event.clientX,
      span: layoutRef.current.find((entry) => entry.id === id)?.span ?? MIN_SPAN,
      snapshot: layoutRef.current,
    };
    setResizingId(id);
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", endResizeRef.current);
    window.addEventListener("pointercancel", endResizeRef.current);
    window.addEventListener("keydown", onResizeKey);
  }, [cancelPress, onResizeKey, onResizeMove]);
  const onResizeKeyDown = useCallback((event, id) => {
    if (dragRef.current || resizeRef.current) return;
    const entry = layoutRef.current.find((item) => item.id === id);
    const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (!entry || !delta || (narrowRef.current && narrowColumns === 1)) return;
    event.preventDefault();
    const span = narrowRef.current ? delta > 0 ? Math.max(3, entry.span) : MIN_SPAN : clampSpan(entry.span + delta);
    if (applySpan(id, span)) latest.current.onLayoutCommit?.(layoutRef.current);
  }, [applySpan, narrowColumns]);

  const verticalNeighbor = useCallback((id, up) => {
    const list = layoutRef.current;
    const rects = rectsRef.current;
    const currentRect = rects.get(id);
    if (!currentRect) return -1;
    const cx = currentRect.x + currentRect.w / 2;
    let best = -1;
    let bestDy = Infinity;
    let bestDx = Infinity;
    for (const [index, entry] of list.entries()) {
      const rect = rects.get(entry.id);
      const inRow = rect && (up ? rect.y + rect.h <= currentRect.y + 1 : rect.y >= currentRect.y + currentRect.h - 1);
      if (!inRow) continue;
      const dy = Math.abs(rect.y - currentRect.y);
      const dx = Math.abs(rect.x + rect.w / 2 - cx);
      if (dy < bestDy - 1 || (Math.abs(dy - bestDy) <= 1 && dx < bestDx)) {
        best = index; bestDy = dy; bestDx = dx;
      }
    }
    return best;
  }, []);
  const neighborIndex = useCallback((id, key) => {
    const list = layoutRef.current;
    const index = list.findIndex((entry) => entry.id === id);
    if (key === "ArrowLeft") return Math.max(0, index - 1);
    if (key === "ArrowRight") return Math.min(list.length - 1, index + 1);
    if (key === "ArrowUp" || key === "ArrowDown") {
      const found = verticalNeighbor(id, key === "ArrowUp");
      return found < 0 ? index : found;
    }
    return null;
  }, [verticalNeighbor]);
  const liftKeyboard = useCallback((id) => {
    if (resizeRef.current) return;
    cancelPress();
    dragRef.current = { id, mode: "keyboard", snapshot: layoutRef.current };
    engine.body(id).liftTarget = 1;
    engine.kick();
    setLiftedId(id);
    announce(`${titleOf(id)} lifted, ${positionText(id)}. Arrow keys move it, Space drops it, Escape cancels.`);
  }, [announce, cancelPress, engine, positionText, titleOf]);
  const moveByKey = useCallback((id, key) => {
    const to = neighborIndex(id, key);
    if (to === null) return false;
    const list = layoutRef.current;
    const from = list.findIndex((entry) => entry.id === id);
    if (to === from) {
      announce(`${titleOf(id)} is at ${positionText(id)}.`);
      return true;
    }
    reorderingRef.current = true;
    preview(moveItem(list, from, to), id);
    announce(`${titleOf(id)} moved to position ${to + 1} of ${list.length}.`);
    return true;
  }, [announce, preview, neighborIndex, positionText, titleOf]);
  const onGripKeyDown = useCallback((event, id) => {
    const drag = dragRef.current;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (drag?.id === id && drag.mode === "keyboard") endDrag(false);
      else if (!drag) liftKeyboard(id);
      return;
    }
    if (drag?.id !== id || drag.mode !== "keyboard") return;
    if (event.key === "Escape") {
      event.preventDefault();
      reorderingRef.current = true;
      endDrag(true);
    } else if (moveByKey(id, event.key)) event.preventDefault();
  }, [endDrag, liftKeyboard, moveByKey]);
  const onGripBlur = useCallback((id) => {
    const drag = dragRef.current;
    if (drag?.mode === "keyboard" && drag.id === id && !reorderingRef.current) endDrag(false);
  }, [endDrag]);

  useEffect(() => () => {
    cancelPressRef.current();
    removeDragListeners();
    removeResizeListeners();
    dragRef.current = null;
    resizeRef.current = null;
    engine.stop();
  }, [engine, removeDragListeners, removeResizeListeners]);

  const showSlots = liftedId !== null || resizingId !== null;
  const columnCount = narrow ? narrowColumns : COLUMNS;
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (showSlots && grid) setSlotRows(Math.max(1, Math.round((grid.offsetHeight + GAP) / (rowHeight + GAP))));
  }, [showSlots, current, narrow, rowHeight]);
  const slotDots = [];
  if (showSlots && slotRows > 0) {
    for (let col = 0; col <= columnCount; col++) {
      for (let row = 0; row <= slotRows; row++) {
        slotDots.push(<circle cx={`${col / columnCount * 100}%`} cy={`${row / slotRows * 100}%`} fill="currentColor" key={`${col}:${row}`} r={1.5} />);
      }
    }
  }

  return (
    <div className={cn(styles.wrapper, className)} ref={wrapRef} style={{ "--wg-narrow-columns": narrowColumns }}>
      <div className={styles.grid} ref={gridRef} style={{ gap: GAP, gridAutoRows: rowHeight }}>
        {slotDots.length ? (
          <svg aria-hidden="true" className={styles.slots} style={{ top: -GAP / 2, left: -GAP / 2, width: `calc(100% + ${GAP}px)`, height: `calc(100% + ${GAP}px)` }}>
            {slotDots}
          </svg>
        ) : null}
        {current.map((entry) => {
          const item = itemsById.get(entry.id);
          if (!item) return null;
          const id = entry.id;
          return (
            <WidgetCell
              cellRef={(el) => {
                if (el) engine.els.set(id, el);
                else engine.els.delete(id);
              }}
              gripRef={(el) => {
                if (el) gripsRef.current.set(id, el);
                else gripsRef.current.delete(id);
              }}
              instructionsId={instructionsId}
              item={item}
              key={id}
              lifted={liftedId === id}
              resizing={resizingId === id}
              narrow={narrow}
              narrowColumns={narrowColumns}
              reducedMotion={reducedMotion}
              onGripBlur={() => onGripBlur(id)}
              onGripKeyDown={(event) => onGripKeyDown(event, id)}
              onGripPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                cancelPress();
                liftPointer(id, event.pointerId, event.clientX, event.clientY);
              }}
              onPressStart={(event) => startPress(event, id)}
              onResizeKeyDown={(event) => onResizeKeyDown(event, id)}
              onResizePointerDown={(event) => startResize(event, id)}
              span={entry.span}
            />
          );
        })}
      </div>
      <p className={styles.srOnly} id={instructionsId}>
        Press Space to pick up. Use the arrow keys to move, Space to drop, and Escape to cancel.
        With a pointer, hold a widget or drag its handle. On the resize handle, use arrow keys or drag to change the width.
      </p>
      <p aria-live="assertive" aria-atomic="true" className={styles.srOnly}>{message}</p>
    </div>
  );
}
