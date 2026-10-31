"use client";

import PropTypes from "prop-types";
import Icon from "@/shared/components/Icon";
import styles from "../token-saver.module.css";

/**
 * One compression strategy: identity tile, name + doc link + status pill, and
 * its inline controls on the right.
 */
export default function StrategyRow({ icon, tone, title, doc, docHref, active, description, control }) {
  return (
    <div className={styles.strategy}>
      <div className={styles.strategyHead}>
        <span className={styles.tile} data-tone={tone} aria-hidden="true">
          <Icon className="text-[20px]">{icon}</Icon>
        </span>
        <div className={styles.strategyBody}>
          <div className={styles.titleLine}>
            <span className={styles.rowTitle}>{title}</span>
            <a href={docHref} target="_blank" rel="noreferrer" className={styles.docLink}>
              {doc}
            </a>
            <span className={`${styles.badge} ${active ? styles.badgeOn : ""}`}>
              <i className={styles.dot} aria-hidden="true" />
              {active ? "Active" : "Off"}
            </span>
          </div>
          <p className={styles.metadata}>{description}</p>
        </div>
        <div className={styles.actions}>{control}</div>
      </div>
    </div>
  );
}

StrategyRow.propTypes = {
  icon: PropTypes.string.isRequired,
  tone: PropTypes.oneOf(["lavender", "pink", "ochre", "mint"]).isRequired,
  title: PropTypes.string.isRequired,
  doc: PropTypes.string.isRequired,
  docHref: PropTypes.string.isRequired,
  active: PropTypes.bool.isRequired,
  description: PropTypes.string.isRequired,
  control: PropTypes.node,
};
