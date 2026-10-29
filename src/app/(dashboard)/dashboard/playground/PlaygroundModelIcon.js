"use client";

import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import ProviderIcon from "@/shared/components/ProviderIcon";
import styles from "./playground.module.css";

export function providerInitials(name) {
  return (name || "?").slice(0, 2).toUpperCase();
}

/** Provider logo for a target, or a neutral tile when there is no connection icon. */
export default function ModelIcon({ providerId, providerName, providerColor, isCombo, size = 16 }) {
  const connectionId = providerId && !isCombo ? providerId : "";
  if (!connectionId) {
    return (
      <span className={styles.modelFallback} style={{ width: size, height: size }}>
        <Icon style={{ fontSize: Math.max(10, Math.round(size * 0.7)) }}>{isCombo ? "layers" : "science"}</Icon>
      </span>
    );
  }
  return (
    <ProviderIcon
      providerId={connectionId}
      alt={providerName || "model"}
      size={size}
      fallbackText={providerInitials(providerName)}
      fallbackColor={providerColor}
    />
  );
}

ModelIcon.propTypes = {
  providerId: PropTypes.string,
  providerName: PropTypes.string,
  providerColor: PropTypes.string,
  isCombo: PropTypes.bool,
  size: PropTypes.number,
};
