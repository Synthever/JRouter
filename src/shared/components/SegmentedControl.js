"use client";

import { cn } from "@/shared/utils/cn";
import Icon from "./Icon";

/**
 * Compact segmented control matching the Dashboard's `dashboard-segment` tokens:
 * neutral surface, 1px inset padding, and a raised active segment.
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
  "aria-label": ariaLabel,
  ...props
}) {
  const sizes = {
    sm: "min-h-7 px-2.5 text-xs",
    md: "min-h-8 px-3 text-xs",
    lg: "min-h-10 px-4 text-sm",
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-0.5 overflow-x-auto",
        "rounded-[var(--r1)] bg-[var(--surface-2)] p-0.5",
        className
      )}
      {...props}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--r1)]",
              "font-mono font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer",
              sizes[size],
              active
                ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-soft)]"
                : "text-[var(--text-2)] hover:text-[var(--text)]"
            )}
          >
            {option.icon && <Icon name={option.icon} className="text-[14px]" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
