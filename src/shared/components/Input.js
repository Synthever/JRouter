"use client";

import { cn } from "@/shared/utils/cn";
import { useId } from "react";
import Icon from "@/shared/components/Icon";

export default function Input({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  hintClassName,
  id,
  ...props
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-mono text-[var(--text-2)] uppercase tracking-wider">
          {label}
          {required && <span className="text-[var(--danger)] ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-[var(--text-3)]">
            <Icon name={icon} className="text-[18px]" />
          </div>
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "w-full py-2 px-3 text-xs sm:text-sm text-[var(--text)] bg-[var(--surface-2)] rounded-[var(--r1)]",
            "border border-[var(--line-2)] placeholder-[var(--text-3)]",
            "focus:outline-none focus:border-[var(--accent-line)] focus:ring-1 focus:ring-[var(--accent-line)]",
            "transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed",
            // iOS zoom fix
            "text-[16px] sm:text-sm",
            icon && "pl-9",
            error && "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/30",
            inputClassName
          )}
          {...props}
        />
      </div>
      {error && (
        <p id={messageId} className="text-xs text-[var(--danger)] flex items-center gap-1 font-mono">
          <Icon name="error" className="text-[14px]" />
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={messageId} className={cn("text-xs text-[var(--text-3)] font-mono", hintClassName)}>{hint}</p>
      )}
    </div>
  );
}
