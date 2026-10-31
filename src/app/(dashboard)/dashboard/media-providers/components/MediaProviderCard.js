"use client";

import Link from "next/link";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Toggle from "@/shared/components/Toggle";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import styles from "../media-providers.module.css";

function getEffectiveStatus(conn) {
  const isCooldown = Object.entries(conn).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
  );
  return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
}

function tileColor(color) {
  return color?.length > 7 ? color : `${color ?? "#888"}15`;
}

/** Provider card shared by the media listing pages (kind page and /web). */
export default function MediaProviderCard({ provider, kind, connections, isCustom = false, onToggle }) {
  const providerInfo = AI_PROVIDERS[provider.id];
  const isNoAuth = !!providerInfo?.noAuth;

  const providerConns = connections.filter((c) => c.provider === provider.id);
  const connected = providerConns.filter((c) => {
    const s = getEffectiveStatus(c);
    return s === "active" || s === "success";
  }).length;
  const error = providerConns.filter((c) => {
    const s = getEffectiveStatus(c);
    return s === "error" || s === "expired" || s === "unavailable";
  }).length;
  const total = providerConns.length;
  const allDisabled = total > 0 && providerConns.every((c) => c.isActive === false);
  const live = total > 0 && !allDisabled;
  const href = `/dashboard/media-providers/${kind}/${provider.id}`;

  return (
    <li className={styles.cardItem}>
      <article className={`${styles.card} ${live ? styles.cardLive : ""} ${allDisabled ? styles.cardOff : ""}`}>
        <Link href={href} className={styles.cardLink} aria-label={`Open ${provider.name}`} />
        <div className={styles.cardHead}>
          <span className={styles.cardLogo} style={{ backgroundColor: tileColor(provider.color) }}>
            <ProviderIcon
              src={`/providers/${provider.id}.png`}
              alt=""
              size={28}
              className="object-contain max-w-7 max-h-7"
              fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
              fallbackColor={provider.color}
            />
          </span>
          <div className={styles.identity}>
            <h3 className={styles.providerName} title={provider.name}>{provider.name}</h3>
            <p className={styles.providerAddress} title={provider.baseUrl || provider.id}>
              {provider.baseUrl || provider.id}
            </p>
          </div>
        </div>

        <div className={styles.cardFoot}>
          <div className={styles.status}>
            {isCustom && <span className={styles.badge}>Custom</span>}
            {isNoAuth ? (
              <span className={`${styles.badge} ${styles.badgeOn}`}>
                <i className={styles.dot} aria-hidden="true" />Ready
              </span>
            ) : allDisabled ? (
              <span className={styles.badge}>Disabled</span>
            ) : total === 0 ? (
              <span className={styles.muted}>No connections</span>
            ) : (
              <>
                {connected > 0 && (
                  <span className={`${styles.badge} ${styles.badgeOn}`}>
                    <i className={styles.dot} aria-hidden="true" />{connected} Connected
                  </span>
                )}
                {error > 0 && (
                  <span className={`${styles.badge} ${styles.badgeError}`}>
                    <i className={styles.dot} aria-hidden="true" />{error} Error
                  </span>
                )}
                {connected === 0 && error === 0 && (
                  <span className={styles.badge}>{total} Added</span>
                )}
              </>
            )}
          </div>
          <div className={styles.actions}>
            {total > 0 && (
              <Toggle
                checked={!allDisabled}
                onChange={() => onToggle?.(provider.id, allDisabled)}
                aria-label={`${allDisabled ? "Enable" : "Disable"} ${provider.name}`}
                title={allDisabled ? "Enable provider" : "Disable provider"}
              />
            )}
          </div>
        </div>
      </article>
    </li>
  );
}

MediaProviderCard.propTypes = {
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    baseUrl: PropTypes.string,
  }).isRequired,
  kind: PropTypes.string.isRequired,
  connections: PropTypes.arrayOf(PropTypes.object).isRequired,
  isCustom: PropTypes.bool,
  onToggle: PropTypes.func,
};
