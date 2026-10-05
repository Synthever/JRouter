"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect } from "react";
import { Card, Skeleton } from "@/shared/components";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";
import { MitmLinkCard } from "./components";
import ToolSummaryCard from "./components/ToolSummaryCard";
import styles from "./cli-tools.module.css";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

export default function CLIToolsPageClient({ machineId }) {
  const [loading, setLoading] = useState(true);
  const [toolStatuses, setToolStatuses] = useState({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(ALL_STATUSES_URL);
        if (res.ok && mounted) setToolStatuses(await res.json());
      } catch (error) {
        console.log("Error fetching tool statuses:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <div className={styles.page} aria-busy="true" aria-label="Loading CLI tools">
        <div className={styles.grid}>
          {Array.from({ length: 6 }, (_, index) => (
            <Card key={index} padding="none" className={styles.tile}>
              <Skeleton className="size-8 shrink-0" />
              <div className={styles.identity}>
                <Skeleton className="h-4 w-28 max-w-full" />
                <Skeleton className="mt-2 h-4 w-20 max-w-full" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const regularTools = Object.entries(CLI_TOOLS);
  const mitmTools = Object.entries(MITM_TOOLS);

  return (
    <div className={styles.page}>
      <div className={styles.grid}>
        {regularTools.map(([toolId, tool]) => (
          <ToolSummaryCard key={toolId} toolId={toolId} tool={tool} status={toolStatuses[toolId]} />
        ))}
      </div>
      <div className={styles.group}>
        <div className={styles.groupHeader}>
          <Icon className="text-[18px]">security</Icon>
          <h2>MITM Tools</h2>
        </div>
        <div className={styles.grid}>
          {mitmTools.map(([toolId, tool]) => (
            <MitmLinkCard key={toolId} tool={tool} />
          ))}
        </div>
      </div>
    </div>
  );
}
