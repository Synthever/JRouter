"use client";

import PropTypes from "prop-types";
import Button from "@/shared/components/Button";
import Icon from "@/shared/components/Icon";
import styles from "../proxy-pools.module.css";

const RELAYS = [
  { kind: "cloudflare", label: "Cloudflare Relay", icon: "cloud", desc: "Worker on Cloudflare's edge" },
  { kind: "vercel", label: "Vercel Relay", icon: "cloud_upload", desc: "Edge function on Vercel" },
  { kind: "deno", label: "Deno Relay", icon: "terminal", desc: "Worker on Deno Deploy" },
  { kind: "netlify", label: "Netlify Relay", icon: "layers", desc: "Function on Netlify's edge" },
];

export default function RelayMenu({ open, onToggle, onSelect, menuRef }) {
  return (
    <div className={styles.menuWrap} ref={menuRef}>
      <Button size="sm" variant="secondary" icon="rocket_launch" onClick={onToggle}>
        Deploy Relay
        <Icon style={{ marginLeft: 4, fontSize: 17 }}>{open ? "expand_less" : "expand_more"}</Icon>
      </Button>

      {open ? (
        <div className={styles.menu} role="menu" aria-label="Deploy relay">
          {RELAYS.map((relay) => (
            <button
              key={relay.kind}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              data-kind={relay.kind}
              onClick={() => onSelect(relay.kind)}
            >
              <span className={styles.menuIcon}><Icon>{relay.icon}</Icon></span>
              <span className={styles.menuText}>
                <span className={styles.menuTitle}>{relay.label}</span>
                <span className={styles.menuDesc}>{relay.desc}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

RelayMenu.propTypes = {
  open: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  menuRef: PropTypes.object,
};
