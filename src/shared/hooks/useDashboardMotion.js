"use client";

import { useEffect, useRef } from "react";

const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const HOVER_QUERY = "(hover: hover)";
const HOVER_SKIP_SELECTOR = '[data-gsap-hover="off"], .dashboard-palette';

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

// Delegated hover hit-test: nearest .ui-card inside <main>, skipping opt-outs,
// the command palette, and bento drag cells ([data-widget-id]).
function resolveHoverCard(target) {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  const card = target.closest(".ui-card");
  if (!card) return null;
  if (!card.closest("main")) return null;
  if (card.closest(HOVER_SKIP_SELECTOR)) return null;
  if (card.closest("[data-widget-id]") || card.querySelector("[data-widget-id]")) return null;
  return card;
}

/**
 * Shell-level dashboard motion: entrance choreography on route change plus a
 * delegated hover-lift for shared .ui-card surfaces. Motion is opt-in based on
 * the user's reduced-motion preference; when reduced motion is requested the
 * hook mounts nothing and leaves the DOM untouched.
 */
export default function useDashboardMotion(rootRef, pathname) {
  const timelineRef = useRef(null);
  const hoverRef = useRef({ attached: false, card: null, touched: null });

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
          const state = hoverRef.current;

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

          const onPointerOver = (event) => {
            const card = resolveHoverCard(event.target);
            if (!card || card === state.card) return;
            if (state.card) {
              gsap.to(state.card, {
                y: 0,
                duration: 0.2,
                ease: "power2.out",
                overwrite: "auto",
                clearProps: "transform",
              });
            }
            state.card = card;
            if (state.touched) state.touched.add(card);
            gsap.to(card, {
              y: -3,
              duration: 0.18,
              ease: "power2.out",
              overwrite: "auto",
            });
          };

          const onPointerOut = (event) => {
            const card = resolveHoverCard(event.target);
            if (!card || card !== state.card) return;
            const next = event.relatedTarget;
            if (next instanceof Node && card.contains(next)) return;
            state.card = null;
            gsap.to(card, {
              y: 0,
              duration: 0.2,
              ease: "power2.out",
              overwrite: "auto",
              clearProps: "transform",
            });
          };

          if (canHover() && !state.attached) {
            state.attached = true;
            state.touched = new Set();
            root.addEventListener("pointerover", onPointerOver);
            root.addEventListener("pointerout", onPointerOut);
          }

          return () => {
            root.removeEventListener("pointerover", onPointerOver);
            root.removeEventListener("pointerout", onPointerOut);
            state.attached = false;

            if (state.touched) {
              state.touched.forEach((card) => {
                if (!card || !card.isConnected) return;
                gsap.killTweensOf(card);
                gsap.set(card, { clearProps: "transform" });
              });
              state.touched.clear();
            }
            state.card = null;

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
