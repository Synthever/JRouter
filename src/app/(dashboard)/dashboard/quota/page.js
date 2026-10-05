import { Suspense } from "react";
import { Skeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";
import styles from "./quota.module.css";

export default function QuotaPage() {
  return (
    <Suspense fallback={
      <div className={`dashboard-surface ${styles.page}`} aria-busy="true" aria-label="Loading quota">
        <div className={`ui-card ${styles.section}`}>
          <Skeleton className="mb-4 h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    }>
      <ProviderLimits />
    </Suspense>
  );
}
