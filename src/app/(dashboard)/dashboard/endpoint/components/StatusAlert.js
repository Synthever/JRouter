"use client";
import styles from "../endpoint.module.css";

/** Reusable status alert */
export default function StatusAlert({ status, className = "" }) {
  const renderMessage = (msg) => {
    const parts = msg.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
      /^https?:\/\//.test(part)
        ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline font-medium">{part}</a>
        : part
    );
  };

  return (
    <div role="status" className={`${styles.alert} ${className} ${status.type === "success" ? styles.success :
        status.type === "warning" ? styles.warning :
        status.type === "info" ? styles.info :
          styles.error
      }`}>
      {renderMessage(status.message)}
    </div>
  );
}
