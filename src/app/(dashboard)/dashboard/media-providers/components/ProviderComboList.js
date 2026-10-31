"use client";

import Link from "next/link";
import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import styles from "../media-providers.module.css";

/** Combo rows listed above the provider grid; hidden when the kind has none. */
export default function ProviderComboList({ combos }) {
  if (!combos?.length) return null;

  return (
    <div className={styles.combos}>
      {combos.map((combo) => (
        <Link
          key={combo.id}
          href={`/dashboard/media-providers/combo/${combo.id}`}
          className={styles.comboItem}
        >
          <Icon className={styles.comboIcon}>layers</Icon>
          <code className={styles.comboName}>{combo.name}</code>
          <div className={styles.comboMembers}>
            {combo.models.slice(0, 6).map((entry, index) => {
              const providerId = typeof entry === "string" ? entry.split("/")[0] : "";
              const provider = AI_PROVIDERS[providerId];
              return (
                <span
                  key={`${entry}-${index}`}
                  title={provider?.name || entry}
                  className={styles.comboMember}
                  style={{ backgroundColor: `${provider?.color ?? "#888"}15` }}
                >
                  <ProviderIcon
                    src={`/providers/${providerId}.png`}
                    alt={provider?.name || providerId}
                    size={18}
                    className={styles.comboLogo}
                    fallbackText={provider?.textIcon || providerId.slice(0, 2).toUpperCase()}
                    fallbackColor={provider?.color}
                  />
                </span>
              );
            })}
            {combo.models.length > 6 && (
              <span className={styles.comboMore}>+{combo.models.length - 6}</span>
            )}
          </div>
          <span className={styles.comboCount}>{combo.models.length}</span>
          <Icon className={styles.comboChevron}>chevron_right</Icon>
        </Link>
      ))}
    </div>
  );
}

ProviderComboList.propTypes = {
  combos: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      models: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.object])).isRequired,
    })
  ).isRequired,
};
