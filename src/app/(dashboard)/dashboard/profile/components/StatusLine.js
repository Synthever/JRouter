"use client";

import Icon from "@/shared/components/Icon";
import styles from "../profile.module.css";

export default function StatusLine({ message, tone = "neutral" }) {
  if (!message) return null;
  return (
    <p
      className={styles.statusLine}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon className="text-[14px]" aria-hidden="true">
        {tone === "danger" ? "error" : "check_circle"}
      </Icon>
      {message}
    </p>
  );
}
