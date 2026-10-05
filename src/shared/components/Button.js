"use client";

import { cn } from "@/shared/utils/cn";
import Icon from "@/shared/components/Icon";

const variants = {
  primary: "bg-white hover:bg-[#EDEDEE] text-[#0A0A0B] border border-transparent shadow-xs disabled:opacity-40",
  contrast: "bg-[var(--text)] hover:bg-[var(--text-2)] text-[var(--bg)] border border-transparent shadow-none disabled:opacity-40",
  secondary: "bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-[var(--text)] border border-[var(--line-2)] disabled:opacity-40",
  outline: "bg-transparent hover:bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line-2)] hover:border-[var(--accent-line)]",
  ghost: "bg-transparent hover:bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text)] border border-transparent",
  danger: "bg-[#281515] hover:bg-[#381a1a] text-[#FF6B6B] border border-[#FF6B6B]/30 disabled:opacity-40",
  success: "bg-[#14251D] hover:bg-[#1b3327] text-[#34D39A] border border-[#34D39A]/30 disabled:opacity-40",
};

const sizes = {
  sm: "h-7 px-2.5 text-xs rounded-[var(--r1)] font-medium",
  md: "h-8.5 px-3.5 text-xs sm:text-[13px] rounded-[var(--r1)] font-medium",
  lg: "h-10 px-5 text-sm rounded-[var(--r1)] font-medium",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      data-variant={variant}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 ease-out cursor-pointer",
        "active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Icon name="progress_activity" className="animate-spin text-[18px]" />
      ) : icon ? (
        <Icon name={icon} className="text-[18px]" />
      ) : null}
      {children}
      {iconRight && !loading && (
        <Icon name={iconRight} className="text-[18px]" />
      )}
    </button>
  );
}
