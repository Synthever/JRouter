"use client";
import Icon from "@/shared/components/Icon";

import { useParams, notFound, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, AddCustomEmbeddingModal } from "@/shared/components";
import { MEDIA_PROVIDER_KINDS, getProvidersByKind } from "@/shared/constants/providers";
import MediaProviderCard from "../components/MediaProviderCard";
import ProviderComboList from "../components/ProviderComboList";
import useProviderToggle from "../components/useProviderToggle";
import styles from "../media-providers.module.css";

// Kinds that support combos (currently disabled for image/tts — temporarily hidden).
// webSearch/webFetch handled by /web page.
const COMBO_KINDS = new Set([]);
const COMBO_BASE_NAMES = { image: "image-combo", tts: "tts-combo" };

export default function MediaProviderKindPage() {
  const { kind } = useParams();
  const router = useRouter();
  const [connections, setConnections] = useState([]);
  const [customNodes, setCustomNodes] = useState([]);
  const [combos, setCombos] = useState([]);
  const [showAddCustomEmbedding, setShowAddCustomEmbedding] = useState(false);

  // webSearch/webFetch listing pages are merged into /web
  useEffect(() => {
    if (kind === "webSearch" || kind === "webFetch") {
      router.replace("/dashboard/media-providers/web");
    }
  }, [kind, router]);

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const isEmbedding = kind === "embedding";
  const supportsCombo = COMBO_KINDS.has(kind);

  useEffect(() => {
    if (!kindConfig) return;
    fetch("/api/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setConnections(d.connections || []))
      .catch(() => {});
    if (isEmbedding) {
      fetch("/api/provider-nodes", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setCustomNodes((d.nodes || []).filter((n) => n.type === "custom-embedding")))
        .catch(() => {});
    }
    if (supportsCombo) {
      fetch("/api/combos", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setCombos(d.combos || []))
        .catch(() => {});
    }
  }, [isEmbedding, supportsCombo, kindConfig]);

  const toggleProvider = useProviderToggle(connections, setConnections);

  if (!kindConfig) return notFound();

  const providers = getProvidersByKind(kind);
  const kindCombos = combos.filter((c) => c.kind === kind);

  // Map custom nodes to the provider-card shape
  const customProviders = customNodes.map((n) => ({
    id: n.id,
    name: n.name || "Custom Embedding",
    color: "#6366F1",
    textIcon: "CE",
  }));

  const allProviders = [...providers, ...customProviders];
  const totalLabel = `${allProviders.length} provider${allProviders.length === 1 ? "" : "s"}`;

  const handleCreateCombo = async () => {
    const base = COMBO_BASE_NAMES[kind] || `${kind}-combo`;
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
          <h1 className={styles.title}>{kindConfig.label}</h1>
          <p className={styles.sub}>
            {totalLabel} ·{" "}
            <code className={styles.endpoint}>
              {kindConfig.endpoint.method} {kindConfig.endpoint.path}
            </code>
          </p>
        </div>
        {(isEmbedding || supportsCombo) && (
          <div className={styles.introActions}>
            {supportsCombo && (
              <Button variant="contrast" icon="add" onClick={handleCreateCombo}>
                Create Combo
              </Button>
            )}
            {isEmbedding && (
              <Button
                variant="contrast"
                icon="add"
                onClick={() => setShowAddCustomEmbedding(true)}
              >
                Add Custom Embedding
              </Button>
            )}
          </div>
        )}
      </header>

      <section className={styles.section} aria-labelledby="media-providers-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="media-providers-heading" className={styles.sectionTitle}>
              <Icon className={styles.sectionIcon}>{kindConfig.icon}</Icon> Providers
              <small>{totalLabel}</small>
            </h2>
            <p className={styles.sectionDescription}>
              Pick a provider to add connections and send {kindConfig.label.toLowerCase()} requests
              through the gateway.
            </p>
          </div>
        </div>

        {supportsCombo && kindCombos.length > 0 && <ProviderComboList combos={kindCombos} />}

        {allProviders.length === 0 ? (
          <div className={styles.empty}>
            No providers support <strong>{kindConfig.label}</strong> yet.
          </div>
        ) : (
          <ul className={styles.grid}>
            {providers.map((provider) => (
              <MediaProviderCard
                key={provider.id}
                provider={provider}
                kind={kind}
                connections={connections}
                onToggle={toggleProvider}
              />
            ))}
            {customProviders.map((provider) => (
              <MediaProviderCard
                key={provider.id}
                provider={provider}
                kind={kind}
                connections={connections}
                isCustom
                onToggle={toggleProvider}
              />
            ))}
          </ul>
        )}
      </section>

      {isEmbedding && (
        <AddCustomEmbeddingModal
          isOpen={showAddCustomEmbedding}
          onClose={() => setShowAddCustomEmbedding(false)}
          onCreated={(node) => {
            setCustomNodes((prev) => [...prev, node]);
            setShowAddCustomEmbedding(false);
          }}
        />
      )}
    </div>
  );
}
