"use client";

import React, { Children, cloneElement, isValidElement, useId, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { cn } from "@/shared/utils/cn";

const DEFAULT_TRANSITION = { ease: "easeInOut", duration: 0.2 };

export function AnimatedBackground({
  children,
  value,
  defaultValue,
  onValueChange,
  className,
  containerClassName,
  transition = DEFAULT_TRANSITION,
  "aria-label": ariaLabel,
}) {
  const id = useId();
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const reducedMotion = useReducedMotion();
  const controlled = value !== undefined;
  const activeValue = controlled ? value : selectedValue;

  return (
    <LayoutGroup id={id}>
      <div role="group" aria-label={ariaLabel} className={cn("inline-flex items-center", containerClassName)}>
        {Children.map(children, (child) => {
          if (!isValidElement(child) || child.props["data-id"] === undefined) return child;
          const childValue = child.props["data-id"];
          const active = childValue === activeValue;

          return cloneElement(child, {
            "aria-pressed": active,
            className: cn("relative isolate", child.props.className),
            onClick: (event) => {
              child.props.onClick?.(event);
              if (event.defaultPrevented || child.props.disabled || active) return;
              if (!controlled) setSelectedValue(childValue);
              onValueChange?.(childValue);
            },
            children: (
              <>
                {active && (
                  <motion.span
                    aria-hidden="true"
                    layoutId="active-background"
                    initial={false}
                    transition={reducedMotion ? { duration: 0 } : transition}
                    className={cn("pointer-events-none absolute inset-0 -z-10", className)}
                  />
                )}
                {child.props.children}
              </>
            ),
          });
        })}
      </div>
    </LayoutGroup>
  );
}