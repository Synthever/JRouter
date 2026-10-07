"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Icon from "@/shared/components/Icon";
import HeaderMenu from "@/shared/components/HeaderMenu";
import HeaderLanguage from "@/shared/components/HeaderLanguage";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { translate } from "@/i18n/runtime";

const getPageInfo = (pathname) => {
  if (!pathname) return { title: "", breadcrumbs: [] };

  // Media provider detail: /dashboard/media-providers/[kind]/[id]
  const mediaDetailMatch = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (mediaDetailMatch) {
    const kindId = mediaDetailMatch[1];
    const providerId = mediaDetailMatch[2];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    const provider = AI_PROVIDERS[providerId];
    return {
      title: provider?.name || providerId,
      breadcrumbs: [
        { label: "Media Providers", href: `/dashboard/media-providers/${kindId}` },
        { label: kindConfig?.label || kindId, href: `/dashboard/media-providers/${kindId}` },
        { label: provider?.name || providerId, image: getProviderIconSrc(providerId) },
      ],
    };
  }

  // Media provider kind: /dashboard/media-providers/[kind]
  const mediaKindMatch = pathname.match(/\/media-providers\/([^/]+)$/);
  if (mediaKindMatch) {
    const kindId = mediaKindMatch[1];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    return {
      title: kindConfig?.label || kindId,
      icon: kindConfig?.icon || "perm_media",
      breadcrumbs: [],
    };
  }

  // Provider detail page: /dashboard/providers/[id]
  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo =
      OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId];
    if (providerInfo) {
      return {
        title: providerInfo.name,
        breadcrumbs: [
          { label: "Providers", href: "/dashboard/providers" },
          {
            label: providerInfo.name,
            image: getProviderIconSrc(providerInfo.id),
          },
        ],
      };
    }
  }

  if (pathname.includes("/providers") && !pathname.includes("/media-providers"))
    return {
      title: "Providers",
      icon: "dns",
      breadcrumbs: [],
    };
  if (pathname.includes("/combos"))
    return {
      title: "Combos",
      icon: "layers",
      breadcrumbs: [],
    };
  if (pathname.includes("/health"))
    return { title: "Model Health", icon: "monitoring", breadcrumbs: [] };
  if (pathname.includes("/usage"))
    return {
      title: "Usage & Analytics",
      icon: "bar_chart",
      breadcrumbs: [],
    };
  if (pathname.includes("/auth-files"))
    return {
      title: "Auth Files",
      icon: "vpn_key",
      breadcrumbs: [],
    };
  if (pathname.includes("/quota"))
    return {
      title: "Quota Tracker",
      icon: "data_usage",
      breadcrumbs: [],
    };
  if (pathname.includes("/mitm"))
    return {
      title: "MITM Proxy",
      icon: "security",
      breadcrumbs: [],
    };
  if (pathname.includes("/token-saver"))
    return {
      title: "Token Saver",
      icon: "savings",
      breadcrumbs: [],
    };
  if (pathname.includes("/cli-tools"))
    return {
      title: "CLI Tools",
      icon: "terminal",
      breadcrumbs: [],
    };
  if (pathname.includes("/proxy-pools"))
    return {
      title: "Proxy Pools",
      icon: "lan",
      breadcrumbs: [],
    };
  if (pathname.includes("/skills"))
    return {
      title: "Agent Skills",
      icon: "extension",
      breadcrumbs: [],
    };
  if (pathname.includes("/endpoint"))
    return {
      title: "Endpoint",
      icon: "api",
      breadcrumbs: [],
    };
  if (pathname.includes("/profile"))
    return {
      title: "Settings",
      icon: "settings",
      breadcrumbs: [],
    };
  if (pathname.includes("/translator"))
    return {
      title: "Translator",
      icon: "translate",
      breadcrumbs: [],
    };
  if (pathname.includes("/console-log"))
    return {
      title: "Console Log",
      icon: "monitor",
      breadcrumbs: [],
    };
  if (pathname === "/dashboard")
    return {
      title: "Dashboard",
      icon: "layout-dashboard",
      breadcrumbs: [],
    };
  return { title: "", breadcrumbs: [] };
};

export default function Header({ onMenuClick, showMenuButton = true }) {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("");
  const [loginMethod, setLoginMethod] = useState("");

  // Memoize page info to prevent unnecessary recalculations
  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const { title, icon, breadcrumbs } = pageInfo;

  useEffect(() => {
    let cancelled = false;

    async function loadAuthStatus() {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setDisplayName(data?.displayName || data?.samlName || data?.samlEmail || data?.oidcName || data?.oidcEmail || "");
          setLoginMethod(data?.loginMethod || "");
        }
      } catch {
        if (!cancelled) {
          setDisplayName("");
          setLoginMethod("");
        }
      }
    }

    loadAuthStatus();
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <header className="dashboard-header shrink-0 flex items-center z-20">
      {/* Sidebar toggle button (Mobile + Desktop) */}
      {showMenuButton && (
        <div className="dashboard-header__navigation flex items-center shrink-0">
          <button
            type="button"
            onClick={onMenuClick}
            className="dashboard-header__action"
            title="Toggle sidebar (Ctrl+B)"
            aria-label="Toggle sidebar"
          >
            <Icon name="panel-left" className="text-[18px]" />
          </button>
        </div>
      )}

      {/* Page title with breadcrumbs */}
      <div className="dashboard-header__title flex flex-col min-w-0 flex-1">
        {breadcrumbs.length > 0 ? (
          <div className="dashboard-header__breadcrumbs flex items-center gap-2 min-w-0">
            {breadcrumbs.map((crumb, index) => (
              <div
                key={`${crumb.label}-${crumb.href || "current"}`}
                className="flex items-center gap-2 min-w-0"
              >
                {index > 0 && (
                  <Icon
                    name="chevron_right"
                    className="text-[var(--text-3)] text-base"
                  />
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="dashboard-header__crumb text-[13px] text-[var(--text-2)] hover:text-[var(--text)] transition-colors truncate"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    {crumb.image && (
                      <ProviderIcon
                        src={crumb.image}
                        alt={crumb.label}
                        size={28}
                        className="object-contain rounded-[var(--r1)] max-w-[28px] max-h-[28px]"
                        fallbackText={crumb.label.slice(0, 2).toUpperCase()}
                      />
                    )}
                    <h1 className="dashboard-header__heading font-semibold text-[var(--text)] tracking-[-0.02em] leading-tight truncate">
                      {translate(crumb.label)}
                    </h1>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : title ? (
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <Icon
                name={icon}
                className="dashboard-header__page-icon"
              />
            )}
            <h1 className="dashboard-header__heading font-semibold text-[var(--text)] tracking-[-0.02em] leading-tight truncate">
              {translate(title)}
            </h1>
          </div>
        ) : null}
      </div>

      {/* Right actions */}
      <div className="dashboard-header__actions flex items-center shrink-0">
        {displayName && (loginMethod === "OIDC" || loginMethod === "SAML") && (
          <div
            className="hidden sm:flex items-center max-w-[220px] px-2.5 py-1 rounded-[var(--r-full)] border border-[var(--line-2)] bg-[var(--surface-2)] text-xs text-[var(--text-2)] truncate font-mono"
            title={displayName}
          >
            <Icon name="person" className="text-[14px] mr-1.5 text-[var(--text)]" />
            <span className="truncate">{displayName}</span>
            <span className="ml-2 shrink-0 rounded-[var(--r-full)] bg-[var(--surface)] border border-[var(--line)] px-1.5 py-0.2 text-[10px] font-mono uppercase text-[var(--text-2)]">
              {loginMethod}
            </span>
          </div>
        )}
        <HeaderSearch />
        <HeaderLanguage />
        <HeaderMenu onLogout={handleLogout} />
      </div>
    </header>
  );
}

function HeaderSearch() {
  const visible = useHeaderSearchStore((s) => s.visible);
  const query = useHeaderSearchStore((s) => s.query);
  const placeholder = useHeaderSearchStore((s) => s.placeholder);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);

  if (!visible) return null;

  return (
    <div className="dashboard-header__search relative">
      <Icon
        name="search"
        className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] text-[16px] pointer-events-none"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full h-9 pl-7 pr-7 rounded-[var(--r1)] border border-[var(--line-2)] bg-[var(--surface-inset)] text-xs text-[var(--text)] placeholder-[var(--text-2)] focus:outline-none focus:border-[var(--accent-line)] transition-colors"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text)] p-0.5 rounded cursor-pointer"
          aria-label="Clear search"
        >
          <Icon name="close" className="text-[16px]" />
        </button>
      )}
    </div>
  );
}

Header.propTypes = {
  onMenuClick: PropTypes.func,
  showMenuButton: PropTypes.bool,
};
