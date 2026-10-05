import { cn } from "@/shared/utils/cn";

const variants = {
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-danger",
  default: "badge-neutral",
};

export default function StatusBadge({ children, variant = "default", dot = true, className }) {
  return (
    <span className={cn(variants[variant], className)}>
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
