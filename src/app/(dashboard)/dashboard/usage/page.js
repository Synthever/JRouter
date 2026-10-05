"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, SegmentedControl, Skeleton } from "@/shared/components";
import UsageStats from "@/shared/components/UsageStats";
import RequestDetailsTab from "./components/RequestDetailsTab";
import styles from "./usage.module.css";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
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
    <div className={`dashboard-surface ${styles.page}`} aria-busy="true" aria-label="Loading usage">
      {[0, 1, 2].map((section) => (
        <div key={section} className={`ui-card ${styles.section}`}>
          <Skeleton className="mb-4 h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
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
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.header}>
        <div className="min-w-0">
          <p className={styles.description}>Requests, tokens and estimated cost across your providers</p>
        </div>
        <div className={styles.controls}>
          <SegmentedControl
            options={[
              { value: "overview", label: "Overview" },
              { value: "details", label: "Details" },
            ]}
            value={activeTab}
            onChange={handleTabChange}
            aria-label="Usage view"
          />
          {activeTab === "overview" && (
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              aria-label="Usage period"
            />
          )}
        </div>
      </header>

      {activeTab === "overview" && (
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-[var(--r3)]" />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
