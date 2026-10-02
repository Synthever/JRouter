"use client";
import Icon from "@/shared/components/Icon";
import styles from "../endpoint.module.css";

/** Security warning banner with optional action link */
export default function SecurityWarning({ message, action }) {
  return (
    <div className={`${styles.alert} ${styles.warning}`}>
      <Icon className="text-[16px] shrink-0 mt-1">warning</Icon>
      <p className="flex-1 min-w-0">{message}</p>
      {action && (
        <a
          href={action.href}
          className="text-sm font-medium underline underline-offset-4 shrink-0 hover:opacity-80"
          onClick={action.href.startsWith("#") ? (e) => {
            e.preventDefault();
            document.getElementById(action.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
          } : undefined}
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
