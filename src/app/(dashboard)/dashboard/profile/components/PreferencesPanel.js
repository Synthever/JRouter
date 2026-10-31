"use client";

import { Button, SegmentedControl } from "@/shared/components";
import Icon from "@/shared/components/Icon";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import SettingsPanel from "./SettingsPanel";
import SettingRow from "./SettingRow";
import ActionRow from "./ActionRow";
import { PROFILE_SECTIONS } from "../profileSections";
import styles from "../profile.module.css";

const meta = PROFILE_SECTIONS[0];

export default function PreferencesPanel({
  theme,
  setTheme,
  locale,
  onOpenLanguage,
  isRemoteHost,
  dbStatus,
  dbLoading,
  onExport,
  onImport,
  importFileRef,
}) {
  return (
    <SettingsPanel id={meta.id} title={meta.title} icon={meta.icon} description={meta.description}>
      <SettingRow label="Appearance" hint="Use a light, dark, or system theme.">
        <SegmentedControl
          aria-label="Appearance"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: "Light", icon: "light_mode" },
            { value: "dark", label: "Dark", icon: "dark_mode" },
            { value: "system", label: "System", icon: "contrast" },
          ]}
        />
      </SettingRow>

      <SettingRow label="Display language" hint="Choose the language used in the dashboard.">
        <Button variant="secondary" onClick={onOpenLanguage} aria-label="Change display language" data-i18n-skip="true">
          <span aria-hidden="true">{LOCALE_FLAGS[locale] || "🌐"}</span>
          <span>{locale}</span>
          <Icon className="text-[14px]" aria-hidden="true">expand_more</Icon>
        </Button>
      </SettingRow>

      <SettingRow
        label={isRemoteHost ? "Remote Mode" : "Local Mode"}
        hint={isRemoteHost ? "Connected to a remote instance." : "Running on your machine."}
      />

      <SettingRow label="Database location" hint="~/.jrouter/db/data.sqlite">
        <div className={styles.actions}>
          <Button variant="secondary" icon="download" loading={dbLoading} onClick={onExport}>
            Download Backup
          </Button>
          <Button variant="secondary" icon="upload" disabled={dbLoading} onClick={() => importFileRef.current?.click()}>
            Import Backup
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImport}
          />
        </div>
      </SettingRow>

      <ActionRow message={dbStatus.message} tone={dbStatus.type === "error" ? "danger" : dbStatus.type === "success" ? "success" : "neutral"} />
    </SettingsPanel>
  );
}
