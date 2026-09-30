"use client";

import { Input } from "@/shared/components";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  const isCopied = copied === copyId;

  return (
    <div className="flex items-center gap-2">
      <span className={`text-[11px] font-mono font-medium px-2 py-1 rounded-[var(--r1)] shrink-0 min-w-[80px] text-center border ${
          (badge === "CF" || badge === "TS") 
            ? "border-[var(--accent-line)] bg-[var(--surface-2)] text-[var(--text)] font-semibold" 
            : "border-[var(--line-2)] bg-[var(--surface-2)] text-[var(--text-2)]"
        }`}>{label}</span>
      <Input value={url} readOnly inputClassName="font-mono text-xs text-[var(--text)] u-tnum" className="flex-1" />
      <button
        type="button"
        onClick={() => onCopy(url, copyId)}
        className="size-8 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-2)] hover:bg-[var(--surface-hover)] text-[var(--text)] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
        title={isCopied ? "Copied" : "Copy URL"}
      >
        <span className={`material-symbols-outlined text-[16px] ${isCopied ? "text-[var(--pos)]" : "text-[var(--text-2)]"}`}>
          {isCopied ? "check" : "content_copy"}
        </span>
      </button>
      {actions}
    </div>
  );
}
