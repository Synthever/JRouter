"use client";

import { Toggle } from "@/shared/components";
import SettingsPanel from "./SettingsPanel";
import SettingRow from "./SettingRow";
import { PROFILE_SECTIONS } from "../profileSections";

const meta = PROFILE_SECTIONS[5];

export default function ObservabilityPanel({ enabled, onChange }) {
  return (
    <SettingsPanel id={meta.id} title={meta.title} icon={meta.icon} description={meta.description}>
      <SettingRow
        label="Enable Observability"
        hint="Record request details for inspection in the logs view"
      >
        <Toggle
          aria-label="Enable Observability"
          checked={enabled === true}
          onChange={onChange}
        />
      </SettingRow>
    </SettingsPanel>
  );
}
