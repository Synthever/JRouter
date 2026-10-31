"use client";

import { useEffect, useRef, useState } from "react";

// Reveals a streaming string at a readable pace instead of letting a whole
// burst of tokens land in one paint. The step scales with the backlog, so the
// visible text catches up within a few frames while the network keeps writing.
export default function useStreamReveal(content, active) {
  const target = content || "";
  const [shown, setShown] = useState(active ? "" : target);
  const shownRef = useRef(shown);
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    if (!active) return undefined;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    let frame = 0;
    let last = 0;

    const tick = (time) => {
      const goal = targetRef.current;
      const current = shownRef.current;
      if (reduce || current.length >= goal.length) {
        if (current !== goal) {
          shownRef.current = goal;
          setShown(goal);
        }
      } else if (time - last >= 32) {
        last = time;
        // Bigger backlog, bigger step: the burst still reads as typing, and
        // the visible text catches up within roughly half a second.
        const step = Math.max(1, Math.ceil((goal.length - current.length) / 24));
        const next = goal.slice(0, current.length + step);
        shownRef.current = next;
        setShown(next);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // When the turn ends, show the final text immediately: the last frames must
  // never truncate a finished answer.
  return active ? shown : target;
}
