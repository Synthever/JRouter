"use client";
import Icon from "@/shared/components/Icon";
import StatusBadge from "@/shared/components/StatusBadge";

import Link from "next/link";
import Image from "next/image";
import { Badge, Card } from "@/shared/components";
import styles from "../cli-tools.module.css";

function getStatus(status, tool) {
  if (tool?.configType === "guide") return { label: "Guide", variant: "default" };
  if (!status) return { label: "Unknown", variant: "default" };
  if (!status.installed) return { label: "Not installed", variant: "default" };
  if (status.has9Router) return { label: "Connected", variant: "success" };
  return { label: "Not configured", variant: "warning" };
}

export default function ToolSummaryCard({ toolId, tool, status }) {
  const s = getStatus(status, tool);
  return (
    <Link href={`/dashboard/cli-tools/${toolId}`} className={styles.toolLink}>
      <Card padding="none" className={styles.tile}>
        <div className={styles.toolIcon}>
          {tool.image ? (
            <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
          ) : tool.icon ? (
            <Icon className="text-[28px]" style={{ color: tool.color }}>{tool.icon}</Icon>
          ) : null}
        </div>
        <div className={styles.identity}>
          <h3 className={styles.title} title={tool.name}>{tool.name}</h3>
          {s.label === "Guide" ? (
            <Badge variant="info" size="sm" className={styles.infoStatus}>{s.label}</Badge>
          ) : (
            <StatusBadge variant={s.variant} dot={s.label === "Connected" || s.label === "Not configured"} className={styles.status}>{s.label}</StatusBadge>
          )}
        </div>
        <Icon className={styles.chevron} size={18}>chevron_right</Icon>
      </Card>
    </Link>
  );
}
