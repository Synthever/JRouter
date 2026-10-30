"use client";

import Image from "next/image";
import Link from "next/link";
import Icon from "@/shared/components/Icon";
import StatusBadge from "@/shared/components/StatusBadge";
import { TYPE_LABELS } from "../cliToolGroups";
import styles from "../../cli-tools.module.css";

/** One tool tile on the CLI Tools index. The whole card is the link. */
export default function ToolCard({ tool, status, href }) {
  return (
    <Link href={href} className={styles.toolCard}>
      <span className={styles.toolHead}>
        <span className={styles.toolLogo}>
          {tool.image ? (
            <Image
              src={tool.image}
              alt=""
              width={28}
              height={28}
              className={styles.toolLogoImage}
              sizes="28px"
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden";
              }}
            />
          ) : (
            <Icon
              className={styles.toolLogoIcon}
              style={tool.color ? { color: tool.color } : undefined}
            >
              {tool.icon || "terminal"}
            </Icon>
          )}
        </span>
        <span className={styles.toolIdentity}>
          <span className={styles.toolName} title={tool.name}>{tool.name}</span>
          <span className={styles.toolDescription} title={tool.description}>{tool.description}</span>
        </span>
      </span>
      <span className={styles.toolFoot}>
        <span className={styles.typeChip}>{TYPE_LABELS[tool.configType] || TYPE_LABELS.custom}</span>
        {status.key === "mitm" || status.key === "guide" ? null : (
          <StatusBadge variant={status.variant} dot={status.dot} className={styles.status}>
            {status.label}
          </StatusBadge>
        )}
      </span>
    </Link>
  );
}
