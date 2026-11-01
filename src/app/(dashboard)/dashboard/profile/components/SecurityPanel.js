"use client";

import { Button, Input, Toggle } from "@/shared/components";
import FieldRow from "@/shared/components/ui/FieldRow";
import SettingsPanel from "./SettingsPanel";
import SettingRow from "./SettingRow";
import ActionRow from "./ActionRow";
import { PROFILE_SECTIONS } from "../profileSections";
import styles from "../profile.module.css";

const meta = PROFILE_SECTIONS[1];

const toneFor = (status) =>
  status.type === "error" ? "danger" : status.type === "success" ? "success" : "neutral";

export default function SecurityPanel({
  settings,
  onRequireLoginChange,
  passwords,
  setPasswords,
  passStatus,
  passLoading,
  onSubmit,
}) {
  return (
    <SettingsPanel id={meta.id} title={meta.title} icon={meta.icon} description={meta.description}>
      <SettingRow
        label="Require login"
        hint="When ON, dashboard requires password. When OFF, access without login."
      >
        <Toggle
          aria-label="Require login"
          checked={settings.requireLogin === true}
          onChange={() => onRequireLoginChange(!settings.requireLogin)}
        />
      </SettingRow>

      {settings.requireLogin === true && (
        <form onSubmit={onSubmit} className={styles.form}>
          {settings.hasPassword && (
            <FieldRow label="Current Password">
              <Input
                aria-label="Current Password"
                autoComplete="current-password"
                type="password"
                placeholder="Enter current password"
                value={passwords.current}
                onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                required
              />
            </FieldRow>
          )}

          <FieldRow label="New Password">
            <Input
              aria-label="New Password"
              autoComplete="new-password"
              type="password"
              placeholder="Enter new password"
              value={passwords.new}
              onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
              required
            />
          </FieldRow>

          <FieldRow label="Confirm New Password">
            <Input
              aria-label="Confirm New Password"
              autoComplete="new-password"
              type="password"
              placeholder="Confirm new password"
              value={passwords.confirm}
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              required
            />
          </FieldRow>

          <ActionRow message={passStatus.message} tone={toneFor(passStatus)}>
            <Button type="submit" variant="contrast" loading={passLoading} className="w-full sm:w-auto">
              {settings.hasPassword ? "Update Password" : "Set Password"}
            </Button>
          </ActionRow>
        </form>
      )}
    </SettingsPanel>
  );
}
