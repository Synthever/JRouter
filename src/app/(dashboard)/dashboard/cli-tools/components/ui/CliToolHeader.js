"use client";

import Image from "next/image";
import Icon from "@/shared/components/Icon";
import StatusBadge from "@/shared/components/StatusBadge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { TYPE_LABELS } from "../cliToolGroups";
import styles from "../../cli-tools.module.css";

/** Detail page header: identity once, status once, endpoint with copy. */
export default function CliToolHeader({ tool, status, baseUrl }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <header className={styles.detailHeader}>
      <div className={styles.detailIdentity}>
        <span className={styles.detailLogo}>
          {tool.image ? (
            <Image
              src={tool.image}
              alt=""
              width={30}
              height={30}
              className={styles.detailLogoImage}
              sizes="30px"
              priority
            />
          ) : (
            <Icon
              className={styles.detailLogoIcon}
              style={tool.color ? { color: tool.color } : undefined}
            >
              {tool.icon || "terminal"}
            </Icon>
          )}
        </span>
        <div className={styles.detailText}>
          <div className={styles.detailTitleRow}>
            <h1 className={styles.title}>{tool.name}</h1>
            <span className={styles.typeChip}>{TYPE_LABELS[tool.configType] || TYPE_LABELS.custom}</span>
            <StatusBadge variant={status.variant} dot={status.dot}>{status.label}</StatusBadge>
          </div>
          <p className={styles.description}>{tool.description}</p>
        </div>
      </div>
      <div className={styles.endpointChip}>
        <span className={styles.endpointValue} title={baseUrl}>{baseUrl || "—"}</span>
        <button
          type="button"
          className={styles.endpointCopy}
          onClick={() => copy(baseUrl, "endpoint")}
          disabled={!baseUrl}
          aria-label="Copy gateway URL"
        >
          <Icon className="text-[16px]">{copied === "endpoint" ? "check" : "content_copy"}</Icon>
        </button>
      </div>
    </header>
  );
}
