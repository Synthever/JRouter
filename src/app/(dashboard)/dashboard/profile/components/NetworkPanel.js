"use client";

import { Button, Input, Toggle } from "@/shared/components";
import FieldRow from "@/shared/components/ui/FieldRow";
import SettingsPanel from "./SettingsPanel";
import SettingRow from "./SettingRow";
import ActionRow from "./ActionRow";
import { PROFILE_SECTIONS } from "../profileSections";
import styles from "../profile.module.css";

const meta = PROFILE_SECTIONS[4];

const toneFor = (status) =>
  status.type === "error" ? "danger" : status.type === "success" ? "success" : "neutral";

export default function NetworkPanel({
  settings,
  proxyForm,
  setProxyForm,
  proxyStatus,
  proxyLoading,
  proxyTestLoading,
  onToggleEnabled,
  onSubmit,
  onTest,
}) {
  const enabled = settings.outboundProxyEnabled === true;

  return (
    <SettingsPanel id={meta.id} title={meta.title} icon={meta.icon} description={meta.description}>
      <SettingRow label="Outbound Proxy" hint="Enable proxy for OAuth + provider outbound requests.">
        <Toggle
          aria-label="Outbound Proxy"
          checked={enabled}
          onChange={() => onToggleEnabled(!enabled)}
          disabled={proxyLoading}
        />
      </SettingRow>

      {enabled ? (
        <form onSubmit={onSubmit} className={styles.form}>
          <FieldRow label="Proxy URL" hint="Leave empty to inherit existing env proxy (if any).">
            <Input
              aria-label="Proxy URL"
              placeholder="http://127.0.0.1:7897"
              value={proxyForm.outboundProxyUrl}
              onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundProxyUrl: e.target.value }))}
              disabled={proxyLoading}
            />
          </FieldRow>

          <FieldRow label="No Proxy" hint="Comma-separated hostnames/domains to bypass the proxy.">
            <Input
              aria-label="No Proxy"
              placeholder="localhost,127.0.0.1"
              value={proxyForm.outboundNoProxy}
              onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundNoProxy: e.target.value }))}
              disabled={proxyLoading}
            />
          </FieldRow>

          <ActionRow message={proxyStatus.message} tone={toneFor(proxyStatus)}>
            <Button
              type="button"
              variant="secondary"
              loading={proxyTestLoading}
              disabled={proxyLoading}
              onClick={onTest}
              className="w-full sm:w-auto"
            >
              Test proxy URL
            </Button>
            <Button type="submit" variant="contrast" loading={proxyLoading} className="w-full sm:w-auto">
              Apply
            </Button>
          </ActionRow>
        </form>
      ) : (
        <ActionRow message={proxyStatus.message} tone={toneFor(proxyStatus)} />
      )}
    </SettingsPanel>
  );
}
