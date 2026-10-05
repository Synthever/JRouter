"use client";
import Icon from "@/shared/components/Icon";

import { useEffect, useMemo, useState } from "react";
import { formatResetTime, getRemainingPercentage } from "./utils";
import { Button } from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";
import styles from "../../../quota/quota.module.css";

const PAGE_SIZE = 10;

/**
 * Format reset time display (Today, 12:00 PM)
 */
function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = "Today";
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
      dayStr = "Tomorrow";
    } else {
      dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

/**
 * Get color classes based on remaining percentage
 */
function getColorClasses(remainingPercentage) {
  if (remainingPercentage > 70) {
    return {
      text: styles.healthy,
      variant: "success",
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: styles.moderate,
      variant: "warning",
    };
  }

  return {
    text: styles.low,
    variant: "error",
  };
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  }

  if (sortMode === "remaining-desc") {
    return [...quotas].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  }

  return quotas;
}

export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
}) {
  const [page, setPage] = useState(1);

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({
      ...quota,
      index,
      remaining: getRemainingPercentage(quota),
    })),
    [quotas],
  );

  const sortedQuotas = useMemo(
    () => sortQuotas(normalizedQuotas, sortMode),
    [normalizedQuotas, sortMode],
  );

  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [sortMode, quotas]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  if (!quotas || quotas.length === 0) {
    return null;
  }

  const currentPageRows = sortedQuotas.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, sortedQuotas.length);

  const sortLabel = "Sorted by account remaining";
  const hasHideAction = typeof onHideQuota === "function";

  return (
    <div className="min-w-0">
      <div className={styles.quotaSummary}>
        <span>{sortedQuotas.length} quota{sortedQuotas.length > 1 ? "s" : ""}</span>
        {showSortLabel && <span>{sortLabel}</span>}
      </div>
      <ul className={styles.quotaList} data-compact={compact}>
        {currentPageRows.map((quota) => {
          const isUnlimited = quota.unlimited === true;
          const isCreditBalance = quota.isCreditBalance === true;
          const sourceQuota = quotas[quota.index];
          const hasKnownLimit = quota.total > 0 || sourceQuota.remaining !== undefined || sourceQuota.remainingPercentage !== undefined;
          const colors = getColorClasses(quota.remaining);
          const countdown = formatResetTime(quota.resetAt);
          const resetDisplay = formatResetTimeDisplay(quota.resetAt);
          const recurring = quota.recurring !== false;
          const countdownLabel = recurring ? `in ${countdown}` : `expires in ${countdown}`;
          const value = isUnlimited
            ? `${quota.used.toLocaleString()} used · Unlimited`
            : isCreditBalance
              ? `Credit: ${quota.total.toFixed(2)} ${quota.currency || ""}`
              : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "Unknown limit"}`;

          return (
            <li key={`${quota.name}-${quota.index}`} className={styles.quotaRow}>
              <span className={styles.quotaName}>{quota.name}</span>
              <div className="min-w-0">
                <div className={styles.quotaSummary}>
                  <span title={value}>{value}</span>
                  <StatusBadge variant={isUnlimited || isCreditBalance || !hasKnownLimit ? "default" : colors.variant}>
                    {isUnlimited ? "Unlimited" : isCreditBalance ? "Balance" : !hasKnownLimit ? "Unknown" : quota.remaining === 0 ? "Exhausted" : `${quota.remaining}% left`}
                  </StatusBadge>
                </div>
                {!isUnlimited && !isCreditBalance && hasKnownLimit && (
                  <div
                    className={`${styles.track} ${colors.text}`}
                    role="progressbar"
                    aria-label={`${quota.name} remaining quota`}
                    aria-valuenow={Math.min(quota.remaining, 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${quota.remaining}% remaining`}
                  >
                    <div className={styles.fill} style={{ width: `${Math.min(quota.remaining, 100)}%` }} />
                  </div>
                )}
              </div>
              <div className={styles.reset} title={quota.resetAt || ""}>
                {countdown !== "-" || resetDisplay ? (
                  <>
                    <span>{countdown !== "-" ? `${recurring ? "Resets " : ""}${countdownLabel}` : resetDisplay}</span>
                    {resetDisplay && countdown !== "-" && <span>{resetDisplay}</span>}
                  </>
                ) : <span>N/A</span>}
              </div>
              {hasHideAction && (
                <button
                  type="button"
                  onClick={() => onHideQuota(quota)}
                  className={styles.iconButton}
                  title="Hide this quota row"
                  aria-label={`Hide quota ${quota.name}`}
                >
                  <Icon className="text-[16px]">visibility_off</Icon>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <span>Showing {pageStart}-{pageEnd} of {sortedQuotas.length}</span>
          <span>Page {page} / {totalPages}</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))} disabled={page === 1}>Prev</Button>
            <Button variant="secondary" size="sm" onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))} disabled={page === totalPages}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
