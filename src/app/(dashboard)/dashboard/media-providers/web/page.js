"use client";
import Icon from "@/shared/components/Icon";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/components";
import { getProvidersByKind } from "@/shared/constants/providers";
import MediaProviderCard from "../components/MediaProviderCard";
import ProviderComboList from "../components/ProviderComboList";
import useProviderToggle from "../components/useProviderToggle";
import styles from "../media-providers.module.css";

function WebSection({ title, icon, kind, description, providers, combos, connections, onCreateCombo, onToggle }) {
  const totalLabel = `${providers.length} provider${providers.length === 1 ? "" : "s"}`;

  return (
    <section className={styles.section} aria-labelledby={`web-${kind}-heading`}>
      <div className={styles.sectionHeader}>
        <div className="min-w-0">
          <h2 id={`web-${kind}-heading`} className={styles.sectionTitle}>
            <Icon className={styles.sectionIcon}>{icon}</Icon> {title}
            <small>
              {totalLabel} · {combos.length} combo{combos.length === 1 ? "" : "s"}
            </small>
          </h2>
          <p className={styles.sectionDescription}>{description}</p>
        </div>
        <Button variant="contrast" icon="add" onClick={onCreateCombo}>
          Create Combo
        </Button>
      </div>

      <ProviderComboList combos={combos} />

      {providers.length === 0 ? (
        <div className={styles.empty}>No providers.</div>
      ) : (
        <ul className={styles.grid}>
          {providers.map((provider) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider}
              kind={kind}
              connections={connections}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function WebProvidersPage() {
  const router = useRouter();
  const [connections, setConnections] = useState([]);
  const [combos, setCombos] = useState([]);

  const fetchAll = async () => {
    try {
      const [connsRes, combosRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/combos", { cache: "no-store" }),
      ]);
      if (connsRes.ok) setConnections((await connsRes.json()).connections || []);
      if (combosRes.ok) setCombos((await combosRes.json()).combos || []);
    } catch { /* noop */ }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAll(); }, []);

  const toggleProvider = useProviderToggle(connections, setConnections);

  const searchProviders = getProvidersByKind("webSearch");
  const fetchProviders = getProvidersByKind("webFetch");
  const searchCombos = combos.filter((c) => c.kind === "webSearch");
  const fetchCombos = combos.filter((c) => c.kind === "webFetch");

  const handleCreateCombo = async (kind) => {
    // Generate unique default name
    const base = kind === "webSearch" ? "search-combo" : "fetch-combo";
    let name = base;
    let i = 1;
    const existing = new Set(combos.map((c) => c.name));
    while (existing.has(name)) { name = `${base}-${i++}`; }
    const res = await fetch("/api/combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, models: [], kind }),
    });
    if (res.ok) {
      const created = await res.json();
      router.push(`/dashboard/media-providers/combo/${created.id}`);
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create combo");
    }
  };

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.intro}>
        <div className={styles.introCopy}>
          <h1 className={styles.title}>Web Search &amp; Fetch</h1>
          <p className={styles.sub}>
            Provider pools for{" "}
            <code className={styles.endpoint}>POST /v1/search</code> and{" "}
            <code className={styles.endpoint}>POST /v1/web/fetch</code>.
          </p>
        </div>
      </header>

      <WebSection
        title="Web Search"
        icon="search"
        kind="webSearch"
        description="Search providers reached through the /v1/search endpoint."
        providers={searchProviders}
        combos={searchCombos}
        connections={connections}
        onCreateCombo={() => handleCreateCombo("webSearch")}
        onToggle={toggleProvider}
      />

      <WebSection
        title="Web Fetch"
        icon="travel_explore"
        kind="webFetch"
        description="Page-to-markdown providers reached through the /v1/web/fetch endpoint."
        providers={fetchProviders}
        combos={fetchCombos}
        connections={connections}
        onCreateCombo={() => handleCreateCombo("webFetch")}
        onToggle={toggleProvider}
      />
    </div>
  );
}
