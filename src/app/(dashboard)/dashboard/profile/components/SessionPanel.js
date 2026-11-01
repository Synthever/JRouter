"use client";

import { Button } from "@/shared/components";
import SettingsPanel from "./SettingsPanel";
import SettingRow from "./SettingRow";
import { PROFILE_SECTIONS } from "../profileSections";
import styles from "../profile.module.css";

const meta = PROFILE_SECTIONS[6];

export default function SessionPanel({ onLogout, onShutdown }) {
  return (
    <SettingsPanel id={meta.id} title={meta.title} icon={meta.icon} description={meta.description}>
      <SettingRow label="Dashboard session" hint="Sign out of the dashboard.">
        <Button variant="secondary" icon="logout" onClick={onLogout}>
          Logout
        </Button>
      </SettingRow>

      <SettingRow label="Stop proxy server" hint="Shut down this JRouter instance.">
        <Button
          variant="danger"
          icon="power_settings_new"
          onClick={onShutdown}
          className={styles.dangerButton}
        >
          Shutdown
        </Button>
      </SettingRow>
    </SettingsPanel>
  );
}
