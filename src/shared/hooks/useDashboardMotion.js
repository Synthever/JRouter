"use client";

import { useEffect, useRef } from "react";
import { MAX_TILT_DEG, TILT_PERSPECTIVE, tiltFromPoint } from "@/shared/utils/cardTilt";

const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const HOVER_QUERY = "(hover: hover)";
const HOVER_SKIP_SELECTOR = '[data-gsap-hover="off"], .dashboard-palette';
const CARD_SELECTOR = ".ui-card, [data-widget-id]";
const SPOTLIGHT_ATTR = "data-gsap-spotlight";
const SPOTLIGHT_GRADIENT =
  "radial-gradient(220px circle at var(--gsap-mx, 50%) var(--gsap-my, 50%), rgba(255, 255, 255, 0.55), transparent 68%)";

// GSAP is loaded lazily so it never lands in the server bundle or the initial
// route payload. The resolved module is cached for subsequent navigations.
let gsapPromise = null;

function loadGsap() {
  if (!gsapPromise) {
    gsapPromise = import("gsap")
      .then((mod) => mod.gsap || mod.default)
      .catch((error) => {
        gsapPromise = null;
        throw error;
      });
  }
  return gsapPromise;
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

function canHover() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(HOVER_QUERY).matches;
}

// Delegated hit-test: nearest interactive card inside <main>. Bento cells are
// skipped while the grid engine owns their transform (drag/resize).
function resolveCard(target) {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  const card = target.closest(CARD_SELECTOR);
  if (!card) return null;
  if (!card.closest("main")) return null;
  if (card.closest(HOVER_SKIP_SELECTOR)) return null;
  if (card.hasAttribute("data-lifted") || card.hasAttribute("data-resizing")) return null;
  return card;
}

// A bento cell's transform belongs to the grid engine, so only its painted
// layers tilt; the cell itself is left untouched.
function tiltTargets(card) {
  if (card.matches("[data-widget-id]")) {
    return [card.firstElementChild, card.children[1]].filter(Boolean);
  }
  return [card];
}

function createSpotlight(card, state, gsap) {
  const spot = document.createElement("span");
  spot.setAttribute(SPOTLIGHT_ATTR, "");
  spot.setAttribute("aria-hidden", "true");

  const bento = card.matches("[data-widget-id]");
  const radiusSource = bento ? card.firstElementChild : card;
  const radius = radiusSource ? getComputedStyle(radiusSource).borderRadius : "0px";

  Object.assign(spot.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    borderRadius: radius,
    background: SPOTLIGHT_GRADIENT,
    mixBlendMode: "soft-light",
    opacity: "0",
  });

  if (bento) {
    const content = card.children[1];
    if (content) card.insertBefore(spot, content);
    else card.appendChild(spot);
  } else {
    if (getComputedStyle(card).position === "static") {
      card.style.position = "relative";
      state.positioned.add(card);
    }
    card.appendChild(spot);
  }

  gsap.to(spot, { opacity: 0.5, duration: 0.2, ease: "power2.out" });
  return spot;
}

function removeSpotlight(state, gsap, { immediate = false } = {}) {
  const spot = state.spot;
  state.spot = null;
  if (!spot) return;
  if (immediate) {
    gsap.killTweensOf(spot);
    spot.remove();
    return;
  }
  gsap.to(spot, { opacity: 0, duration: 0.16, onComplete: () => spot.remove() });
}

function beginCard(card, state, gsap) {
  state.generation += 1;
  state.card = card;
  state.targets = tiltTargets(card);

  gsap.set(state.targets, {
    transformPerspective: TILT_PERSPECTIVE,
    transformOrigin: "50% 50%",
  });
  gsap.to(state.targets, {
    y: -2,
    duration: 0.25,
    ease: "power2.out",
    overwrite: "auto",
  });

  state.rotationX = gsap.quickTo(state.targets, "rotationX", {
    duration: 0.35,
    ease: "power2.out",
    overwrite: "auto",
  });
  state.rotationY = gsap.quickTo(state.targets, "rotationY", {
    duration: 0.35,
    ease: "power2.out",
    overwrite: "auto",
  });

  state.spot = createSpotlight(card, state, gsap);
  state.targets.forEach((target) => state.touched.add(target));
}

function resetCard(state, gsap, { immediate = false } = {}) {
  const { targets } = state;
  const generation = ++state.generation;
  state.card = null;
  state.targets = null;
  state.rotationX = null;
  state.rotationY = null;

  removeSpotlight(state, gsap, { immediate });

  if (targets && targets.length > 0) {
    if (immediate) {
      gsap.killTweensOf(targets);
      gsap.set(targets, {
        rotationX: 0,
        rotationY: 0,
        y: 0,
        clearProps: "transform,transformPerspective",
      });
    } else {
      gsap.to(targets, {
        rotationX: 0,
        rotationY: 0,
        y: 0,
        duration: 0.3,
        ease: "power2.out",
        overwrite: "auto",
        onComplete: () => {
          // A quick re-entry owns the transform now; do not clear its pose.
          if (state.generation === generation) {
            gsap.set(targets, { clearProps: "transform,transformPerspective" });
          }
        },
      });
    }
  }
}

/**
 * Shell-level dashboard motion: entrance choreography on route change plus a
 * delegated cursor-following 3D tilt and spotlight for interactive cards.
 * Motion is opt-in based on the user's reduced-motion preference; when reduced
 * motion is requested the hook mounts nothing and leaves the DOM untouched.
 */
export default function useDashboardMotion(rootRef, pathname) {
  const timelineRef = useRef(null);
  const pointerRef = useRef({
    attached: false,
    card: null,
    targets: null,
    spot: null,
    rotationX: null,
    rotationY: null,
    generation: 0,
    pressed: false,
    positioned: new Set(),
    touched: new Set(),
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const root = rootRef?.current;
    if (!root) return undefined;
    if (prefersReducedMotion()) return undefined;

    let alive = true;
    let mm = null;

    loadGsap()
      .then((gsap) => {
        if (!alive || !gsap || !rootRef?.current) return;

        mm = gsap.matchMedia();

        mm.add(MOTION_QUERY, () => {
          const state = pointerRef.current;

          const ctx = gsap.context(() => {
            const tl = gsap.timeline();

            const pageChildren = Array.from(root.querySelectorAll(".page > *"));
            if (pageChildren.length > 0) {
              tl.from(
                pageChildren,
                {
                  opacity: 0,
                  y: 10,
                  duration: 0.38,
                  stagger: 0.04,
                  ease: "power3.out",
                  clearProps: "opacity,transform",
                },
                0
              );
            }

            const headerChrome = Array.from(
              root.querySelectorAll(".dashboard-header__crumbs, .dashboard-header__actions")
            );
            if (headerChrome.length > 0) {
              tl.from(
                headerChrome,
                {
                  opacity: 0,
                  y: -4,
                  duration: 0.3,
                  ease: "power2.out",
                  clearProps: "opacity,transform",
                },
                0
              );
            }

            const sidebarItems = Array.from(root.querySelectorAll(".dashboard-sidebar__item"));
            if (sidebarItems.length > 0) {
              tl.from(
                sidebarItems,
                {
                  opacity: 0,
                  x: -6,
                  duration: 0.25,
                  stagger: 0.015,
                  ease: "power2.out",
                  clearProps: "opacity,transform",
                },
                0
              );
            }

            timelineRef.current = tl;
          }, root);

          const onPointerMove = (event) => {
            if (state.pressed) return;

            const card = resolveCard(event.target);
            if (!card) return;

            if (card !== state.card) {
              resetCard(state, gsap, { immediate: true });
              beginCard(card, state, gsap);
            }

            const rect = state.card.getBoundingClientRect();
            const tilt = tiltFromPoint(rect, event.clientX, event.clientY, MAX_TILT_DEG);
            if (state.spot) {
              state.spot.style.setProperty("--gsap-mx", `${tilt.mx}%`);
              state.spot.style.setProperty("--gsap-my", `${tilt.my}%`);
            }
            state.rotationX?.(tilt.rotationX);
            state.rotationY?.(tilt.rotationY);
          };

          const onPointerOut = (event) => {
            if (!state.card) return;
            const next = event.relatedTarget;
            if (next instanceof Node && state.card.contains(next)) return;
            resetCard(state, gsap);
          };

          // The bento grid takes over on pointerdown; clear the tilt before the
          // long-press timer lifts the cell so the two transforms never fight.
          const onPointerDown = (event) => {
            if (!state.card || !state.card.matches("[data-widget-id]")) return;
            if (!(event.target instanceof Element) || !event.target.closest("[data-widget-id]")) return;
            state.pressed = true;
            resetCard(state, gsap, { immediate: true });
          };

          const onPointerUp = () => {
            state.pressed = false;
          };

          if (canHover() && !state.attached) {
            state.attached = true;
            root.addEventListener("pointermove", onPointerMove);
            root.addEventListener("pointerout", onPointerOut);
            root.addEventListener("pointerdown", onPointerDown);
            root.addEventListener("pointerup", onPointerUp);
            root.addEventListener("pointercancel", onPointerUp);
          }

          return () => {
            root.removeEventListener("pointermove", onPointerMove);
            root.removeEventListener("pointerout", onPointerOut);
            root.removeEventListener("pointerdown", onPointerDown);
            root.removeEventListener("pointerup", onPointerUp);
            root.removeEventListener("pointercancel", onPointerUp);
            state.attached = false;
            state.pressed = false;

            resetCard(state, gsap, { immediate: true });

            state.touched.forEach((target) => {
              if (!target || !target.isConnected) return;
              gsap.killTweensOf(target);
              gsap.set(target, { clearProps: "transform,transformPerspective" });
            });
            state.touched.clear();
            state.positioned.forEach((card) => {
              if (card && card.isConnected) card.style.position = "";
            });
            state.positioned.clear();
            root.querySelectorAll(`[${SPOTLIGHT_ATTR}]`).forEach((node) => node.remove());

            if (timelineRef.current) {
              timelineRef.current.kill();
              timelineRef.current = null;
            }

            ctx.revert();
          };
        });
      })
      .catch(() => {
        // GSAP unavailable (offline chunk, CSP, etc.) - leave the DOM untouched.
      });

    return () => {
      alive = false;
      if (mm) {
        mm.revert();
        mm = null;
      }
      if (timelineRef.current) {
        timelineRef.current.kill();
        timelineRef.current = null;
      }
    };
  }, [pathname, rootRef]);

  return null;
}
