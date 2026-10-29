"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, Skeleton } from "@/shared/components";
import UsageStats from "@/shared/components/UsageStats";
import { AnimatedBackground } from "@/components/core/animated-background";
import { cn } from "@/shared/utils/cn";
import RequestDetailsTab from "./components/RequestDetailsTab";
import PillTabs from "./components/PillTabs";
import { PERIOD_OPTIONS } from "./periods";
import styles from "./usage.module.css";

const VIEW_OPTIONS = [
  { value: "overview", label: "Overview" },
  { value: "details", label: "Details" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<UsageFallback />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageFallback() {
  return (
    <div className={`dashboard-surface dashboard-usage ${styles.page}`} aria-busy="true" aria-label="Loading usage">
      <div className={styles.statsSkeleton}>
        {[0, 1, 2, 3, 4].map((card) => (
          <Skeleton key={card} className={styles.statSkeleton} />
        ))}
      </div>
      <div className={styles.section}>
        <Skeleton className="mb-5 h-4 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className={`dashboard-surface dashboard-usage ${styles.page}`}>
      <header className={styles.intro}>
        <h1 className={styles.title}>Usage</h1>
        <p className={styles.sub}>Requests, tokens and estimated cost across your providers.</p>
      </header>

      <div className={styles.toolbar}>
        <PillTabs
          options={VIEW_OPTIONS}
          value={activeTab}
          onChange={handleTabChange}
          ariaLabel="Usage view"
        />
        {activeTab === "overview" && (
          <div className={styles.periodControl}>
            <AnimatedBackground
              value={period}
              onValueChange={setPeriod}
              aria-label="Usage period"
              containerClassName={cn("dashboard-segmented-control", styles.periods)}
              className="dashboard-segment-highlight"
            >
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  data-id={option.value}
                  type="button"
                  aria-label={`${option.label} usage`}
                  className="dashboard-segment"
                >
                  {option.label}
                </button>
              ))}
            </AnimatedBackground>
          </div>
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-[var(--r3)]" />}>
          <UsageStats period={period} />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
