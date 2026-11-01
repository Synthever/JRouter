"use client";

import { Input, Toggle } from "@/shared/components";
import FieldRow from "@/shared/components/ui/FieldRow";
import SettingsPanel from "./SettingsPanel";
import SettingRow from "./SettingRow";
import { PROFILE_SECTIONS } from "../profileSections";

const meta = PROFILE_SECTIONS[3];

export default function RoutingPanel({
  settings,
  onFallbackStrategy,
  onStickyLimit,
  onComboStrategy,
  onComboStickyLimit,
}) {
  const roundRobin = settings.fallbackStrategy === "round-robin";
  const comboRoundRobin = settings.comboStrategy === "round-robin";
  const stickyLimit = settings.stickyRoundRobinLimit || 3;
  const comboStickyLimit = settings.comboStickyRoundRobinLimit || 1;

  // Same two sentences the inline block printed under the rows; the panel
  // header is the only place left for them.
  const summary =
    (roundRobin
      ? `Currently distributing requests across all available accounts with ${stickyLimit} calls per account.`
      : "Currently using accounts in priority order (Fill First).") +
    (comboRoundRobin
      ? ` Combos rotate after ${comboStickyLimit} call${comboStickyLimit === 1 ? "" : "s"} per model.`
      : " Combos always start with their first model.");

  return (
    <SettingsPanel id={meta.id} title={meta.title} icon={meta.icon} description={summary}>
      <SettingRow label="Round Robin" hint="Cycle through accounts to distribute load">
        <Toggle
          aria-label="Round Robin"
          checked={roundRobin}
          onChange={() => onFallbackStrategy(roundRobin ? "fill-first" : "round-robin")}
        />
      </SettingRow>

      {roundRobin && (
        <FieldRow label="Sticky Limit" hint="Calls per account before switching">
          <Input
            aria-label="Sticky Limit"
            type="number"
            min="1"
            max="10"
            value={stickyLimit}
            onChange={(e) => onStickyLimit(e.target.value)}
            className="w-20"
          />
        </FieldRow>
      )}

      <SettingRow
        label="Combo Round Robin"
        hint="Cycle through providers in combos instead of always starting with first"
      >
        <Toggle
          aria-label="Combo Round Robin"
          checked={comboRoundRobin}
          onChange={() => onComboStrategy(comboRoundRobin ? "fallback" : "round-robin")}
        />
      </SettingRow>

      {comboRoundRobin && (
        <FieldRow label="Combo Sticky Limit" hint="Calls per combo model before switching">
          <Input
            aria-label="Combo Sticky Limit"
            type="number"
            min="1"
            max="100"
            value={comboStickyLimit}
            onChange={(e) => onComboStickyLimit(e.target.value)}
            className="w-20"
          />
        </FieldRow>
      )}
    </SettingsPanel>
  );
}
