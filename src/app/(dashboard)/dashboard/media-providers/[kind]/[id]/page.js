"use client";
import Icon from "@/shared/components/Icon";

import { useParams, notFound, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Button, AddCustomEmbeddingModal, NoAuthProxyCard } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import ConnectionsCard from "@/app/(dashboard)/dashboard/providers/components/ConnectionsCard";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard";
import ProviderConfigPanel from "./components/ProviderConfigPanel";
import { KIND_EXAMPLE_CONFIG } from "./components/exampleShared";
import { EmbeddingExampleCard } from "./components/EmbeddingExampleCard";
import { TtsExampleCard } from "./components/TtsExampleCard";
import { GenericExampleCard } from "./components/GenericExampleCard";
import { SttExampleCard } from "./components/SttExampleCard";
import styles from "../../media-providers.module.css";

// MediaProviderDetailPage
export default function MediaProviderDetailPage() {
  const { kind, id } = useParams();
  const router = useRouter();
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const isCustom = isCustomEmbeddingProvider(id) && kind === "embedding";

  const handleDeleteCustom = async () => {
    if (!confirm("Delete this Custom Embedding node?")) return;
    try {
      const res = await fetch(`/api/provider-nodes/${id}`, { method: "DELETE" });
      if (res.ok) router.push(`/dashboard/media-providers/${kind}`);
    } catch (error) {
      console.log("Error deleting custom embedding node:", error);
    }
  };

  const [customNode, setCustomNode] = useState(null);
  const [customLoading, setCustomLoading] = useState(isCustom);
  const [showEditModal, setShowEditModal] = useState(false);

  // Fetch custom node info from API for custom embedding nodes
  useEffect(() => {
    if (!isCustom) return;
    let cancelled = false;
    fetch("/api/provider-nodes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCustomNode((d.nodes || []).find((n) => n.id === id) || null);
        setCustomLoading(false);
      })
      .catch(() => { if (!cancelled) setCustomLoading(false); });
    return () => { cancelled = true; };
  }, [id, isCustom]);

  if (!kindConfig) return notFound();

  const builtInProvider = AI_PROVIDERS[id];

  // For custom embedding nodes, build a synthetic provider object
  const provider = isCustom
    ? (customNode ? { id, name: customNode.name || "Custom Embedding", color: "#6366F1", textIcon: "CE" } : null)
    : builtInProvider;

  if (!isCustom && !builtInProvider) return notFound();
  if (isCustom && !customLoading && !customNode) return notFound();
  if (isCustom && customLoading) {
    return (
      <div className={`dashboard-surface ${styles.page}`}>
        <section className={styles.panel}>
          <div className={styles.loading} />
        </section>
      </div>
    );
  }

  const kinds = isCustom ? ["embedding"] : (provider.serviceKinds ?? ["llm"]);
  if (!isCustom && !kinds.includes(kind)) return notFound();

  const config =
    kind === "webFetch" ? provider.fetchConfig
      : kind === "tts" ? provider.ttsConfig
      : kind === "stt" ? provider.sttConfig
      : kind === "embedding" ? provider.embeddingConfig
      : kind === "systemone" ? provider.systemoneConfig
      : provider.searchConfig || (provider.searchViaChat
        ? {
            mode: "chat-completions",
            defaultModel: provider.searchViaChat.defaultModel,
            pricingUrl: provider.searchViaChat.pricingUrl,
            freeTier: provider.searchViaChat.freeTier,
          }
        : null);

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <div>
        <Link href={`/dashboard/media-providers/${kind}`} className={styles.backLink}>
          <Icon className="text-[16px]">arrow_back</Icon>
          {kindConfig.label}
        </Link>
      </div>

      <header className={styles.detailHead}>
        <span className={styles.detailLogo} style={{ backgroundColor: `${provider.color}15` }}>
          <ProviderIcon
            src={`/providers/${provider.id}.png`}
            alt=""
            size={40}
            className="object-contain max-w-10 max-h-10"
            fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
            fallbackColor={provider.color}
          />
        </span>

        <div className={styles.detailIdentity}>
          <div className={styles.detailNameRow}>
            <h1 className={styles.detailTitle}>{provider.name}</h1>
            {!isCustom && provider.notice?.apiKeyUrl && (
              <a
                href={provider.notice.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.detailLink}
              >
                <Icon className="text-[14px]">open_in_new</Icon>
                Get API Key
              </a>
            )}
          </div>
          <div className={styles.detailBadges}>
            {isCustom && <span className={styles.badge}>Custom · {customNode?.prefix}</span>}
            {kinds.map((k) => (
              <span
                key={k}
                className={`${styles.badge} ${k === kind ? styles.badgeCurrent : ""}`}
              >
                {k.toUpperCase()}
              </span>
            ))}
          </div>
          <p className={styles.detailSub}>
            {kindConfig.endpoint.method} {kindConfig.endpoint.path}
          </p>
        </div>

        {isCustom && (
          <div className={styles.detailActions}>
            <Button size="sm" variant="outline" icon="edit" onClick={() => setShowEditModal(true)}>
              Edit
            </Button>
            <Button size="sm" variant="danger" icon="delete" onClick={handleDeleteCustom}>
              Delete
            </Button>
          </div>
        )}
      </header>

      {!isCustom && provider.kindNotice?.[kind] && (
        <div className={styles.noticeWarn}>
          <Icon className="text-[18px]">warning</Icon>
          <p>{provider.kindNotice[kind]}</p>
        </div>
      )}

      {!isCustom && provider.notice?.text && !provider.deprecated && (
        <div className={styles.noticeInfo}>
          <Icon className="text-[16px]">info</Icon>
          <p>{provider.notice.text}</p>
          {provider.notice.apiKeyUrl && (
            <a
              href={provider.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.noticeLink}
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {!isCustom && provider.noAuth ? (
        <NoAuthProxyCard providerId={id} />
      ) : (
        <ConnectionsCard providerId={id} isOAuth={false} />
      )}

      {kind !== "tts" && kind !== "webSearch" && kind !== "webFetch" && (
        <ModelsCard
          providerId={id}
          kindFilter={kind}
          providerAliasOverride={isCustom ? customNode?.prefix : undefined}
        />
      )}

      {!isCustom && config && (
        <ProviderConfigPanel config={config} provider={provider} title={`${kindConfig.label} Config`} />
      )}

      {/* Example — per kind */}
      {kind === "embedding" && (
        <EmbeddingExampleCard providerId={id} customAlias={customNode?.prefix} />
      )}
      {kind === "tts" && <TtsExampleCard providerId={id} />}
      {kind === "stt" && !isCustom && <SttExampleCard providerId={id} />}
      {!isCustom && KIND_EXAMPLE_CONFIG[kind] && <GenericExampleCard providerId={id} kind={kind} />}

      {isCustom && (
        <AddCustomEmbeddingModal
          isOpen={showEditModal}
          node={customNode}
          onClose={() => setShowEditModal(false)}
          onSaved={(updated) => {
            setCustomNode(updated);
            setShowEditModal(false);
          }}
        />
      )}
    </div>
  );
}
