import { Suspense } from "react";
import { Skeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";
import styles from "./quota.module.css";

export default function QuotaPage() {
  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.intro}>
        <h1 className={styles.title}>Quota</h1>
        <p className={styles.sub}>Remaining capacity, account limits and reset times across your providers.</p>
      </header>
      <Suspense
        fallback={
          <div className={styles.content} aria-busy="true" aria-label="Loading quota">
            <div className={styles.statsSkeleton}>
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className={styles.statSkeleton} />
              ))}
            </div>
            <section className={styles.section}>
              <Skeleton className="mb-4 h-4 w-40" />
              <Skeleton className="h-24 w-full" />
            </section>
          </div>
        }
      >
        <ProviderLimits />
      </Suspense>
    </div>
  );
}
