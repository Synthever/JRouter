"use client";
import Icon from "@/shared/components/Icon";
import StatusBadge from "@/shared/components/StatusBadge";

import Link from "next/link";
import { Card } from "@/shared/components";
import Image from "next/image";
import styles from "../cli-tools.module.css";

export default function MitmLinkCard({ tool }) {
  return (
    <Link href="/dashboard/mitm" className={styles.toolLink}>
      <Card padding="none" className={styles.tile}>
        <div className={styles.toolIcon}>
          <Image
            src={tool.image}
            alt={tool.name}
            width={32}
            height={32}
            className="size-8 object-contain rounded-lg"
            sizes="32px"
            onError={(e) => { e.target.style.display = "none"; }}
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className={styles.identity}>
          <div className={styles.titleLine}>
            <h3 className={styles.title} title={tool.name}>{tool.name}</h3>
            <StatusBadge dot={false} className={styles.status}>MITM</StatusBadge>
          </div>
          <p className={styles.description} title={tool.description}>{tool.description}</p>
        </div>
        <Icon className={styles.chevron} size={18}>chevron_right</Icon>
      </Card>
    </Link>
  );
}
