"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/shared/components/Icon";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  STATUS_FILTERS,
  countStatuses,
  filterEntries,
  groupTools,
} from "./components/cliToolGroups";
import ToolCard from "./components/ui/ToolCard";
import styles from "./cli-tools.module.css";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

const METRICS = [
  { key: "connected", tone: "toneTeal", note: "routing through JRouter" },
  { key: "needsSetup", tone: "toneOchre", note: "installed, still pointing elsewhere" },
  { key: "notInstalled", tone: "toneLavender", note: "not found on this machine" },
  { key: "guide", tone: "tonePeach", note: "manual setup, this app cannot write it" },
];

export default function CLIToolsPageClient() {
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState({});
  const [statusError, setStatusError] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [origin, setOrigin] = useState("");
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- origin is only readable after mount; keeping it out of the server render avoids a hydration mismatch
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(ALL_STATUSES_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) setStatuses(data || {});
      } catch (error) {
        console.error("Error fetching tool statuses:", error);
        if (mounted) setStatusError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const totalTools = Object.keys(CLI_TOOLS).length;
  const counts = useMemo(() => countStatuses(CLI_TOOLS, statuses), [statuses]);
  const groups = useMemo(() => groupTools(CLI_TOOLS, MITM_TOOLS, statuses), [statuses]);
  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, entries: filterEntries(group.entries, { query, status: filter }) }))
        .filter((group) => group.entries.length > 0),
    [groups, query, filter],
  );
  const gateway = origin || "";
  const gatewayUrl = gateway ? `${gateway}/v1` : "";

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div className={styles.introText}>
          <h1 className={styles.introTitle}>CLI Tools</h1>
          <p className={styles.introSub}>
            Point every coding CLI, editor and TUI at this gateway. Each tool reads one config file or
            env block — JRouter writes it for you, or hands you the snippet.
          </p>
        </div>
        <div className={styles.gateway}>
          <span className={styles.gatewayValue} title={gatewayUrl}>{gateway || "—"}</span>
          <span className={styles.gatewayHint}>/v1</span>
          <button
            type="button"
            className={styles.gatewayCopy}
            onClick={() => copy(gatewayUrl, "gateway")}
            disabled={!gatewayUrl}
            aria-label="Copy gateway URL"
          >
            <Icon className="text-[16px]">{copied === "gateway" ? "check" : "content_copy"}</Icon>
          </button>
          <span className="sr-only" aria-live="polite">
            {copied === "gateway" ? "Gateway URL copied" : ""}
          </span>
        </div>
      </header>

      <section className={styles.metrics} aria-label="Tool status summary">
        {METRICS.map((metric) => (
          <div key={metric.key} className={`${styles.metric} ${styles[metric.tone]}`}>
            <p className={styles.metricValue}>
              {loading || statusError ? "—" : counts[metric.key]}
              {metric.key === "connected" ? (
                <small className={styles.metricUnit}>of {totalTools}</small>
              ) : null}
            </p>
            <p className={styles.metricNote}>
              {statusError ? "Status unavailable" : metric.note}
            </p>
          </div>
        ))}
      </section>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Icon className={styles.searchIcon} aria-hidden="true">search</Icon>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search tools…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search tools"
          />
        </div>
        <div className={styles.tabs} role="group" aria-label="Filter tools by status">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.tab}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {statusError ? (
        <div className={`${styles.notice} ${styles.noticeBanner} ${styles.warning}`}>
          Tool statuses could not be read. Every card is listed below as Unknown.
        </div>
      ) : null}

      {!loading && visibleGroups.length === 0 ? (
        <div className={styles.empty} role="status">
          <p className={styles.emptyTitle}>No tools match</p>
          <p className={styles.emptyHint}>Try another search or clear the status filter.</p>
        </div>
      ) : null}

      {loading ? (
        <section className={styles.section} aria-busy="true" role="status">
          <span className="sr-only">Loading CLI tools</span>
          <ul className={styles.gridList} role="list">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index}>
                <div className={`${styles.toolCard} ${styles.toolCardSkeleton}`}>
                  <span className={styles.toolHead}>
                    <span className={styles.toolLogo} />
                    <span className={styles.toolIdentity}>
                      <span className={styles.toolName} aria-hidden="true">Loading…</span>
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        visibleGroups.map((group) => (
          <section key={group.key} className={styles.section} aria-labelledby={`group-${group.key}`}>
            <div className={styles.sectionHeader}>
              <Icon className={styles.sectionIcon} aria-hidden="true">{group.icon}</Icon>
              <div className={styles.sectionHeading}>
                <div className={styles.sectionTitleRow}>
                  <h2 id={`group-${group.key}`} className={styles.sectionTitle}>{group.label}</h2>
                  <span className={styles.sectionCount}>{group.entries.length}</span>
                </div>
                <p className={styles.sectionDescription}>{group.description}</p>
              </div>
            </div>
            <ul className={styles.gridList} role="list">
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <ToolCard tool={entry.tool} status={entry.status} href={entry.href} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
