"use client";

import Image from "next/image";
import Icon from "@/shared/components/Icon";
import StatusBadge from "@/shared/components/StatusBadge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { cn } from "@/shared/utils/cn";
import { TYPE_LABELS } from "../cliToolGroups";
import styles from "../../cli-tools.module.css";

/** Detail page header: identity once, status once, endpoint with copy. */
export default function CliToolHeader({ tool, status, baseUrl }) {
  const { copied, copy } = useCopyToClipboard();
  // A tool that needs an externally reachable URL cannot use a loopback one;
  // say so instead of handing over a URL this app can never reach.
  const needsExternal =
    Boolean(tool.requiresExternalUrl) &&
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(baseUrl || "");
  // The chip truncates with an ellipsis, so the sentence has to live in `title`
  // as well as the visible label — otherwise the warning is unreadable.
  const loopbackWarning = "Loopback is not reachable from this app";
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
            <h1 className={styles.detailTitle}>{tool.name}</h1>
            <span className={styles.typeChip}>{TYPE_LABELS[tool.configType] || TYPE_LABELS.custom}</span>
            <StatusBadge variant={status.variant} dot={status.dot}>{status.label}</StatusBadge>
          </div>
          <p className={styles.detailDescription}>{tool.description}</p>
        </div>
      </div>
      <div className={cn(styles.endpointChip, needsExternal && styles.endpointWarning)}>
        <span className={styles.endpointValue} title={needsExternal ? loopbackWarning : baseUrl}>
          {needsExternal ? loopbackWarning : baseUrl || "—"}
        </span>
        <button
          type="button"
          className={styles.endpointCopy}
          onClick={() => copy(baseUrl, "endpoint")}
          disabled={!baseUrl}
          aria-label="Copy gateway URL"
        >
          <Icon className="text-[16px]">{copied === "endpoint" ? "check" : "content_copy"}</Icon>
        </button>
        <span className="sr-only" aria-live="polite">
          {copied === "endpoint" ? "Gateway URL copied" : ""}
        </span>
      </div>
    </header>
  );
}
