"use client";

import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import styles from "./playground.module.css";

export default function PlaygroundModelIcon({ providerId, providerName, providerColor, isCombo, size = 18 }) {
  if (!providerId) {
    return (
      <span className={styles.modelFallback} style={{ width: size, height: size }}>
        <Icon style={{ fontSize: Math.max(10, Math.round(size * 0.7)) }}>
          {isCombo ? "layers" : "science"}
        </Icon>
      </span>
    );
  }
  return (
    <ProviderIcon
      providerId={providerId}
      alt={providerName || "model"}
      size={size}
      fallbackText={(providerName || "?").slice(0, 2).toUpperCase()}
      fallbackColor={providerColor}
    />
  );
}

PlaygroundModelIcon.propTypes = {
  providerId: PropTypes.string,
  providerName: PropTypes.string,
  providerColor: PropTypes.string,
  isCombo: PropTypes.bool,
  size: PropTypes.number,
};
