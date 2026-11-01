"use client";
import { useState, useEffect } from "react";
import { Button, Input, CardSkeleton } from "@/shared/components";
import Modal, { ConfirmModal } from "@/shared/components/Modal";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import { useTheme } from "@/shared/hooks/useTheme";
import { APP_CONFIG } from "@/shared/constants/config";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { PROFILE_SECTIONS, activeSectionId } from "./profileSections";
import { useProfileSettings } from "./useProfileSettings";
import { useSsoSettings } from "./hooks/useSsoSettings";
import { useNetworkSettings } from "./hooks/useNetworkSettings";
import { useBackupSettings } from "./hooks/useBackupSettings";
import PreferencesPanel from "./components/PreferencesPanel";
import SecurityPanel from "./components/SecurityPanel";
import SsoPanel from "./components/SsoPanel";
import RoutingPanel from "./components/RoutingPanel";
import NetworkPanel from "./components/NetworkPanel";
import ObservabilityPanel from "./components/ObservabilityPanel";
import SessionPanel from "./components/SessionPanel";
import styles from "./profile.module.css";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function ProfilePage() {
  const { theme, setTheme } = useTheme();
  const [locale, setLocale] = useState(() => getLocaleFromCookie());
  const [langOpen, setLangOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [activeId, setActiveId] = useState(PROFILE_SECTIONS[0].id);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);

  const { settings, setSettings, loading, loadError, reload } = useProfileSettings(applySettingsToForms);

  const sso = useSsoSettings({ settings, setSettings });
  const { setOidcForm, setOidcClientSecret, setSsoTypeTab, setSamlForm, setOidcExpanded } = sso;

  const network = useNetworkSettings({ settings, setSettings });
  const { setProxyForm } = network.proxy;

  const backup = useBackupSettings({ setSettings });
  const { dbAuth, setDbAuth, dbLoading, handleDbAuthConfirm, isRemoteHost } = backup;

  // Scroll spy for the chip toolbar. Measures each panel against the same
  // scroller the browser uses for the anchor jumps.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const scroller =
      document.querySelector("[data-page-scroller]") ||
      document.querySelector("main .custom-scrollbar");
    const target = scroller || window;
    const measure = () => {
      const offsets = PROFILE_SECTIONS.map((section) => {
        const el = document.getElementById(section.id);
        if (!el) return { id: section.id, top: Number.POSITIVE_INFINITY };
        const top = scroller
          ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
          : el.getBoundingClientRect().top;
        return { id: section.id, top };
      });
      setActiveId(activeSectionId(offsets, 96));
    };
    const frame = requestAnimationFrame(measure);
    target.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [loading]);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "Passwords do not match" });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setPassStatus({ type: "success", message: "Password updated successfully" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        setPassStatus({ type: "error", message: data.error || "Failed to update password" });
      }
    } catch (err) {
      setPassStatus({ type: "error", message: "An error occurred" });
    } finally {
      setPassLoading(false);
    }
  };

  const updateRequireLogin = async (requireLogin) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error("Failed to update require login:", err);
    }
  };

  const updateObservabilityEnabled = async (enabled) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableObservability: enabled }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, enableObservability: enabled }));
      }
    } catch (err) {
      console.error("Failed to update enableObservability:", err);
    }
  };

  const observabilityEnabled = settings.enableObservability === true;

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.assign("/login");
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  // Forms keep their own editable copies of the settings they edit. They are
  // hydrated from the same response the hook stores, so a retry refills them
  // exactly like the old single-fetch loader did. It is a hoisted declaration
  // because the settings hook has to receive it before the panel hooks mount.
  function applySettingsToForms(data) {
    setOidcForm({
      authMode: data?.authMode || "password",
      oidcIssuerUrl: data?.oidcIssuerUrl || "",
      oidcClientId: data?.oidcClientId || "",
      oidcScopes: data?.oidcScopes || "openid profile email",
      oidcLoginLabel: data?.oidcLoginLabel || "Sign in with OIDC",
    });
    setOidcClientSecret("");
    setSsoTypeTab(data?.ssoType || "saml");
    setSamlForm({
      samlEntryPoint: data?.samlEntryPoint || "",
      samlIssuer: data?.samlIssuer || "urn:jrouter:sp",
      samlCert: data?.samlCert || "",
      samlLoginLabel: data?.samlLoginLabel || "Sign in with SAML SSO",
      samlAttributeEmail: data?.samlAttributeEmail || "email",
      samlAttributeName: data?.samlAttributeName || "name",
    });
    if (
      data?.authMode === "sso" ||
      data?.authMode === "saml" ||
      data?.authMode === "oidc" ||
      data?.authMode === "both"
    ) {
      setOidcExpanded(true);
    }
    setProxyForm({
      outboundProxyEnabled: data?.outboundProxyEnabled === true,
      outboundProxyUrl: data?.outboundProxyUrl || "",
      outboundNoProxy: data?.outboundNoProxy || "",
    });
  }

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div className={styles.introText}>
          <h1 className={styles.introTitle}>Profile</h1>
          <p className={styles.introSub}>Preferences, security, and settings for your JRouter instance.</p>
        </div>
      </header>

      <nav className={styles.toolbar} aria-label="Jump to a settings section">
        {PROFILE_SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={styles.chip}
            aria-current={activeId === section.id ? "true" : undefined}
            onClick={() => setActiveId(section.id)}
          >
            {section.label}
          </a>
        ))}
      </nav>

      {loading ? (
        <div className={styles.stack} aria-busy="true" aria-label="Loading profile settings">
          <CardSkeleton />
        </div>
      ) : loadError ? (
        <>
          <p className={styles.loadError} role="alert">{loadError}</p>
          <div className={styles.actions}>
            <Button variant="secondary" icon="refresh" onClick={reload}>Retry</Button>
          </div>
        </>
      ) : (
      <div className={styles.stack}>
        <PreferencesPanel theme={theme} setTheme={setTheme} locale={locale}
          onOpenLanguage={() => setLangOpen(true)} {...backup} />

        <SecurityPanel settings={settings} onRequireLoginChange={updateRequireLogin} passwords={passwords}
          setPasswords={setPasswords} passStatus={passStatus} passLoading={passLoading} onSubmit={handlePasswordChange} />

        <SsoPanel settings={settings} {...sso} />

        <RoutingPanel settings={settings} {...network.routing} />

        <NetworkPanel settings={settings} {...network.proxy} />

        {/* Observability Settings */}
        <ObservabilityPanel enabled={observabilityEnabled} onChange={updateObservabilityEnabled} />

        {/* Account actions */}
        <SessionPanel onLogout={handleLogout} onShutdown={() => setShutdownOpen(true)} />

        {/* App Info */}
        <div className={styles.appInfo}>
          <p>{APP_CONFIG.name} v{APP_CONFIG.version}</p>
          <p className="mt-1">{isRemoteHost ? "Remote Mode" : "Local Mode - All data stored on your machine"}</p>
        </div>
      </div>
      )}

      <LanguageSwitcher dialogClassName={styles.languageDialog} hideTrigger isOpen={langOpen}
        onClose={(next) => {
          setLangOpen(false);
          setLocale(next);
        }} />
      <ConfirmModal className={styles.dialog} isOpen={shutdownOpen} onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown} title="Close Proxy" message="Are you sure you want to close the proxy server?"
        confirmText="Close" cancelText="Cancel" variant="danger" loading={isShuttingDown} />

      <Modal className={styles.dialog} isOpen={dbAuth.open} onClose={() => setDbAuth({ open: false, mode: "", password: "" })}
        title="Confirm Password" size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDbAuth({ open: false, mode: "", password: "" })} disabled={dbLoading}>Cancel</Button>
            <Button variant="contrast" onClick={handleDbAuthConfirm} loading={dbLoading} disabled={!dbAuth.password}>Confirm</Button>
          </>
        }
      >
        <p className="text-text-muted mb-3 text-sm">
          Enter your current password to {dbAuth.mode === "export" ? "export" : "import"} the database.
        </p>
        <Input label="Current password" autoComplete="current-password" type="password" value={dbAuth.password}
          onChange={(e) => setDbAuth((s) => ({ ...s, password: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter" && dbAuth.password) handleDbAuthConfirm(); }}
          placeholder="Current password" autoFocus />
      </Modal>

    </div>
  );
}
