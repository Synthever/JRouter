"use client";

import { useState } from "react";
import { Button, Input, SegmentedControl } from "@/shared/components";
import Icon from "@/shared/components/Icon";
import FieldRow from "@/shared/components/ui/FieldRow";
import SettingsPanel from "./SettingsPanel";
import SettingRow from "./SettingRow";
import ActionRow from "./ActionRow";
import StatusLine from "./StatusLine";
import { PROFILE_SECTIONS } from "../profileSections";
import styles from "../profile.module.css";

const meta = PROFILE_SECTIONS[2];

const toneFor = (status) =>
  status.type === "error" ? "danger" : status.type === "success" ? "success" : "neutral";

const methodLabel = (settings) => (settings.ssoType === "saml" ? "SAML 2.0" : "OIDC");

// The three sentences the inline header used to print, driven by the live mode.
const describe = (settings) => {
  if (
    settings.authMode === "sso" ||
    settings.authMode === "oidc" ||
    settings.authMode === "saml"
  ) {
    return `${methodLabel(settings)} SSO active`;
  }
  if (settings.authMode === "both") {
    return `Password + ${methodLabel(settings)} active`;
  }
  return meta.description;
};

export default function SsoPanel({
  settings,
  expanded,
  onToggleExpanded,
  ssoTypeTab,
  setSsoTypeTab,
  oidcForm,
  updateOidcForm,
  oidcClientSecret,
  setOidcClientSecret,
  oidcStatus,
  oidcLoading,
  oidcTestStatus,
  oidcTestLoading,
  onSaveOidc,
  onTestOidc,
  samlForm,
  updateSamlForm,
  samlStatus,
  samlLoading,
  samlTestStatus,
  samlTestLoading,
  onSaveSaml,
  onTestSaml,
  onIdpMetadataUpload,
  onCertUpload,
  samlAcsUrl,
  samlMetadataUrl,
  oidcRedirectUri,
  idpMetadataFileRef,
  certFileRef,
}) {
  const [showSamlGuide, setShowSamlGuide] = useState(false);
  const [copyStatus, setCopyStatus] = useState({ type: "", message: "" });

  const copyValue = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus({ type: "success", message: `${label} copied to clipboard!` });
    } catch {
      setCopyStatus({ type: "error", message: `Unable to copy ${label.toLowerCase()}` });
    }
  };

  const authModes = [
    { value: "password", title: "Password only", desc: "Keep legacy password login." },
    {
      value: "sso",
      title: `${ssoTypeTab === "saml" ? "SAML" : "OIDC"} only`,
      desc: "Require SSO for dashboard access.",
    },
    { value: "both", title: "Both", desc: "Allow password or SSO login." },
  ];

  const currentMode = oidcForm.authMode;
  const isActive = (value) =>
    value === "password"
      ? currentMode === "password"
      : value === "sso"
        ? currentMode === "sso" || currentMode === "saml" || currentMode === "oidc"
        : currentMode === "both";

  return (
    <SettingsPanel
      id={meta.id}
      title={meta.title}
      icon={meta.icon}
      description={describe(settings)}
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls="profile-sso-settings"
          iconRight={expanded ? "expand_less" : "expand_more"}
        >
          {expanded ? "Collapse" : "Configure"}
        </Button>
      }
    >
      {expanded ? (
        <div id="profile-sso-settings" className={styles.form}>
          <p className={styles.settingHint}>
            Configure enterprise Single Sign-On (SSO) for dashboard access using SAML 2.0 or OIDC.
          </p>

          <SettingRow label="SSO Protocol">
            <SegmentedControl
              aria-label="SSO Protocol"
              value={ssoTypeTab}
              onChange={setSsoTypeTab}
              options={[
                { value: "saml", label: "SAML 2.0" },
                { value: "oidc", label: "OIDC" },
              ]}
              className="self-start"
            />
          </SettingRow>

          <div className="flex flex-col gap-2">
            <p className={styles.settingLabel}>Auth Mode</p>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
              {authModes.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  onClick={() => updateOidcForm("authMode", option.value)}
                  variant="outline"
                  className={styles.choice}
                  aria-pressed={isActive(option.value)}
                  disabled={oidcLoading || samlLoading}
                >
                  <span className={styles.settingTitle}>{option.title}</span>
                  <span className={styles.settingDescription}>{option.desc}</span>
                </Button>
              ))}
            </div>
          </div>

          {ssoTypeTab === "saml" ? (
            <>
              {/* IdP Setup Guidelines Banner & Collapsible Drawer */}
              <div className={styles.inset}>
                <button
                  type="button"
                  onClick={() => setShowSamlGuide((prev) => !prev)}
                  className={styles.disclosure}
                  aria-expanded={showSamlGuide}
                  aria-controls="profile-saml-guide"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="text-text-muted text-lg" aria-hidden="true">menu_book</Icon>
                    <div>
                      <p className="font-semibold text-xs sm:text-sm text-text-main">
                        IdP Setup Guidelines & Provider Configuration Instructions
                      </p>
                      <p className="text-[11px] text-text-muted">
                        Click to view setup steps for AWS IAM Identity Center, Okta, Entra ID, Keycloak, & Authentik
                      </p>
                    </div>
                  </div>
                  <Icon className="text-text-muted transition-transform text-lg"
                    style={{ transform: showSamlGuide ? "rotate(180deg)" : "none" }}>
                    expand_more
                  </Icon>
                </button>

                {showSamlGuide && (
                  <div id="profile-saml-guide" className={styles.guide}>
                    <div className={styles.inset}>
                      <p className="font-semibold mb-1">Required Service Provider (SP) Values for your IdP Setup:</p>
                      <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
                        <li>
                          <b>Assertion Consumer Service (ACS) URL:</b>{" "}
                          <code className="bg-bg px-1 py-0.5 rounded break-all">{samlAcsUrl}</code>
                        </li>
                        <li>
                          <b>SP Entity ID / Audience URI:</b>{" "}
                          <code className="bg-bg px-1 py-0.5 rounded break-all">{samlForm.samlIssuer || "urn:jrouter:sp"}</code>
                        </li>
                        <li>
                          <b>NameID Format:</b>{" "}
                          <code className="bg-bg px-1 py-0.5 rounded">EmailAddress</code> or <code className="bg-bg px-1 py-0.5 rounded">Unspecified</code>
                        </li>
                      </ul>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                        <p className="font-semibold text-text-main flex items-center gap-1.5">
                          AWS IAM Identity Center
                        </p>
                        <ol className="list-decimal pl-4 text-text-muted space-y-1">
                          <li>Applications → <b>Add application</b> → Select <b>Add custom SAML 2.0 application</b>.</li>
                          <li>Set <b>Application ACS URL</b> to <code className="text-text-main font-mono">{samlAcsUrl}</code>.</li>
                          <li>Set <b>Application SAML audience</b> to <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:jrouter:sp"}</code>.</li>
                          <li>Under <i>Attribute mappings</i>, map <code className="text-text-main font-mono">Subject</code> or <code className="text-text-main font-mono">email</code> to <code className="text-text-main font-mono">${`{user:email}`}</code>.</li>
                          <li>Download <b>IAM Identity Center SAML metadata XML</b> file and use 1-Click Import below!</li>
                        </ol>
                      </div>

                      <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                        <p className="font-semibold text-text-main flex items-center gap-1.5">
                          Microsoft Entra ID (Azure AD)
                        </p>
                        <ol className="list-decimal pl-4 text-text-muted space-y-1">
                          <li>Enterprise Applications → <b>New application</b> → <b>Create your own application</b>.</li>
                          <li>Select <b>Single sign-on</b> → <b>SAML</b>.</li>
                          <li><b>Identifier (Entity ID):</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:jrouter:sp"}</code></li>
                          <li><b>Reply URL (ACS):</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                          <li>Download <b>Federation Metadata XML</b> and import or copy X.509 Certificate.</li>
                        </ol>
                      </div>

                      <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                        <p className="font-semibold text-text-main flex items-center gap-1.5">
                          Okta / Auth0
                        </p>
                        <ol className="list-decimal pl-4 text-text-muted space-y-1">
                          <li>Applications → <b>Create App Integration</b> → Select <b>SAML 2.0</b>.</li>
                          <li><b>Single Sign-On URL:</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                          <li><b>Audience URI (SP Entity ID):</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:jrouter:sp"}</code></li>
                          <li>Name ID format: <i>EmailAddress</i>.</li>
                          <li>Download Identity Provider metadata XML or copy the X.509 cert.</li>
                        </ol>
                      </div>

                      <div className="p-3 rounded border border-border bg-bg/50 flex flex-col gap-1.5">
                        <p className="font-semibold text-text-main flex items-center gap-1.5">
                          Keycloak / Authentik
                        </p>
                        <ol className="list-decimal pl-4 text-text-muted space-y-1">
                          <li>Clients → <b>Create client</b> → Select <b>SAML</b>.</li>
                          <li><b>Client ID:</b> <code className="text-text-main font-mono">{samlForm.samlIssuer || "urn:jrouter:sp"}</code></li>
                          <li><b>Master SAML Processing URL:</b> <code className="text-text-main font-mono">{samlAcsUrl}</code></li>
                          <li>Export SAML Descriptor XML or copy IDP Certificate PEM.</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 1-Click IdP Metadata Import */}
              <SettingRow
                label="1-Click IdP Metadata XML Import"
                hint="Auto-fill SSO URL, Issuer & Cert from XML metadata"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  icon="upload_file"
                  onClick={() => idpMetadataFileRef.current?.click()}
                >
                  Upload Metadata XML
                </Button>
                <input
                  ref={idpMetadataFileRef}
                  type="file"
                  accept=".xml,application/xml,text/xml"
                  className="hidden"
                  onChange={onIdpMetadataUpload}
                />
              </SettingRow>

              <FieldRow label="Single Sign-On Service URL (samlEntryPoint)">
                <Input
                  aria-label="Single Sign-On Service URL"
                  placeholder="https://idp.example.com/app/saml/sso/..."
                  value={samlForm.samlEntryPoint}
                  onChange={(e) => updateSamlForm("samlEntryPoint", e.target.value)}
                  disabled={samlLoading}
                />
              </FieldRow>

              <FieldRow label="SP Entity ID / Audience (samlIssuer)">
                <Input
                  aria-label="SP Entity ID / Audience"
                  placeholder="urn:jrouter:sp"
                  value={samlForm.samlIssuer}
                  onChange={(e) => updateSamlForm("samlIssuer", e.target.value)}
                  disabled={samlLoading}
                />
              </FieldRow>

              <FieldRow
                label="IdP X.509 Certificate (samlCert)"
                hint="Paste raw Base64 certificate or PEM block."
                aside={
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      icon="file_upload"
                      onClick={() => certFileRef.current?.click()}
                    >
                      Upload Certificate
                    </Button>
                    <input
                      ref={certFileRef}
                      type="file"
                      accept=".crt,.pem,.cer,text/plain"
                      className="hidden"
                      onChange={onCertUpload}
                    />
                  </>
                }
              >
                <textarea
                  aria-label="IdP X.509 Certificate"
                  rows={4}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;MIIC...&#10;-----END CERTIFICATE-----"
                  value={samlForm.samlCert}
                  onChange={(e) => updateSamlForm("samlCert", e.target.value)}
                  className="w-full font-mono resize-y"
                  disabled={samlLoading}
                />
              </FieldRow>

              <FieldRow label="Login Button Label">
                <Input
                  aria-label="Login Button Label"
                  placeholder="Sign in with SAML SSO"
                  value={samlForm.samlLoginLabel}
                  onChange={(e) => updateSamlForm("samlLoginLabel", e.target.value)}
                  disabled={samlLoading}
                />
              </FieldRow>

              <FieldRow label="Email Claim Attribute">
                <Input
                  aria-label="Email Claim Attribute"
                  placeholder="email"
                  value={samlForm.samlAttributeEmail}
                  onChange={(e) => updateSamlForm("samlAttributeEmail", e.target.value)}
                  disabled={samlLoading}
                />
              </FieldRow>

              <FieldRow label="Display Name Claim">
                <Input
                  aria-label="Display Name Claim"
                  placeholder="name"
                  value={samlForm.samlAttributeName}
                  onChange={(e) => updateSamlForm("samlAttributeName", e.target.value)}
                  disabled={samlLoading}
                />
              </FieldRow>

              <div className={styles.inset}>
                <SettingRow
                  label="ACS Callback URL"
                  hint={<code className="break-all font-mono text-xs">{samlAcsUrl}</code>}
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    icon="content_copy"
                    aria-label="Copy ACS Callback URL"
                    onClick={() => copyValue(samlAcsUrl, "ACS URL")}
                  >
                    Copy
                  </Button>
                </SettingRow>

                <SettingRow
                  label="SP XML Metadata"
                  hint={<code className="break-all font-mono text-xs">{samlMetadataUrl}</code>}
                >
                  <a
                    href={samlMetadataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download="jrouter-sp-metadata.xml"
                    className={styles.linkButton}
                  >
                    <Icon className="text-[16px]">download</Icon>
                    Download XML
                  </a>
                </SettingRow>
              </div>

              <ActionRow message={samlStatus.message} tone={toneFor(samlStatus)}>
                <Button
                  type="button"
                  variant="contrast"
                  loading={samlLoading}
                  onClick={() => onSaveSaml(oidcForm.authMode)}
                  className="w-full sm:w-auto"
                >
                  Save SAML settings
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  loading={samlTestLoading}
                  onClick={onTestSaml}
                  className="w-full sm:w-auto"
                >
                  Test SAML settings
                </Button>
              </ActionRow>
              <StatusLine message={samlTestStatus.message} tone={toneFor(samlTestStatus)} />
              <StatusLine message={copyStatus.message} tone={toneFor(copyStatus)} />
            </>
          ) : (
            <>
              <FieldRow label="Issuer URL">
                <Input
                  aria-label="Issuer URL"
                  placeholder="https://auth.example.com/application/o/jrouter/"
                  value={oidcForm.oidcIssuerUrl}
                  onChange={(e) => updateOidcForm("oidcIssuerUrl", e.target.value)}
                  disabled={oidcLoading}
                />
              </FieldRow>

              <FieldRow label="Client ID">
                <Input
                  aria-label="Client ID"
                  placeholder="jrouter-dashboard"
                  value={oidcForm.oidcClientId}
                  onChange={(e) => updateOidcForm("oidcClientId", e.target.value)}
                  disabled={oidcLoading}
                />
              </FieldRow>

              <FieldRow label="Client Secret" hint="This value is write-only after saving.">
                <Input
                  aria-label="Client Secret"
                  type="password"
                  placeholder="Leave blank to keep existing secret"
                  value={oidcClientSecret}
                  onChange={(e) => setOidcClientSecret(e.target.value)}
                  disabled={oidcLoading}
                />
              </FieldRow>

              <FieldRow label="Scopes">
                <Input
                  aria-label="Scopes"
                  placeholder="openid profile email"
                  value={oidcForm.oidcScopes}
                  onChange={(e) => updateOidcForm("oidcScopes", e.target.value)}
                  disabled={oidcLoading}
                />
              </FieldRow>

              <FieldRow label="Login Button Label">
                <Input
                  aria-label="Login Button Label"
                  placeholder="Sign in with OIDC"
                  value={oidcForm.oidcLoginLabel}
                  onChange={(e) => updateOidcForm("oidcLoginLabel", e.target.value)}
                  disabled={oidcLoading}
                />
              </FieldRow>

              <div className={styles.inset}>
                <SettingRow
                  label="Redirect URI"
                  hint={<code className="break-all font-mono text-xs">{oidcRedirectUri}</code>}
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    icon="content_copy"
                    aria-label="Copy redirect URI"
                    onClick={() => copyValue(oidcRedirectUri, "Redirect URI")}
                  >
                    Copy
                  </Button>
                </SettingRow>
              </div>

              <ActionRow message={oidcStatus.message} tone={toneFor(oidcStatus)}>
                <Button
                  type="button"
                  variant="contrast"
                  loading={oidcLoading}
                  onClick={() => onSaveOidc()}
                  className="w-full sm:w-auto"
                >
                  Save OIDC settings
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  loading={oidcTestLoading}
                  onClick={onTestOidc}
                  className="w-full sm:w-auto"
                >
                  Test connection
                </Button>
              </ActionRow>
              <StatusLine message={oidcTestStatus.message} tone={toneFor(oidcTestStatus)} />
              <StatusLine message={copyStatus.message} tone={toneFor(copyStatus)} />
            </>
          )}

          {settings.authMode === "oidc" || settings.authMode === "saml" || settings.authMode === "sso" ? (
            <p className={styles.notice} role="status">
              SSO login ({methodLabel(settings)}) is currently active. Password login is disabled until you switch back.
            </p>
          ) : null}

          {settings.authMode === "both" ? (
            <p className={styles.notice} role="status">
              Password and SSO login ({methodLabel(settings)}) are both active.
            </p>
          ) : null}
        </div>
      ) : null}
    </SettingsPanel>
  );
}
