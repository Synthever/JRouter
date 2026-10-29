"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Icon from "@/shared/components/Icon";
import HeaderMenu from "@/shared/components/HeaderMenu";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import { buildDashboardSearchIndex } from "@/shared/constants/dashboardNav";
import { Bell, ChevronRight, PanelLeft, Search, X } from "lucide-react";

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
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [loginMethod, setLoginMethod] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const searchInputRef = useRef(null);
  const contextualSearch = useHeaderSearchStore((s) => s.visible);
  const notifications = useNotificationStore((s) => s.notifications);
  const removeNotification = useNotificationStore((s) => s.removeNotification);

  // Memoize page info to prevent unnecessary recalculations
  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const { title, icon, breadcrumbs } = pageInfo;
  const crumbs = breadcrumbs.length > 0 ? breadcrumbs : title ? [{ label: title, icon }] : [];

  const navigateTo = useCallback((href) => {
    setSearchOpen(false);
    setSearchQuery("");
    router.push(href);
  }, [router]);

  const searchEntries = useMemo(() => buildDashboardSearchIndex(), []);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return searchEntries;
    return searchEntries.filter((entry) => (
      entry.label.toLowerCase().includes(query)
      || entry.group.toLowerCase().includes(query)
      || entry.href.toLowerCase().includes(query)
    ));
  }, [searchEntries, searchQuery]);

  const initials = useMemo(() => {
    const words = displayName.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "JR";
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }, [displayName]);

  const dateText = useSyncExternalStore(
    () => () => {},
    () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase(),
    () => "",
  );

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

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [searchOpen]);

  useEffect(() => {
    if (!bellOpen) return;
    const onPointerDown = (event) => {
      if (bellRef.current && !bellRef.current.contains(event.target)) setBellOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setBellOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [bellOpen]);

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

  const onSearchKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult((index) => Math.min(index + 1, Math.max(0, searchResults.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = searchResults[activeResult];
      if (target) navigateTo(target.href);
    }
  };

  return (
    <header className="dashboard-header shrink-0 relative z-40">
      <div className="dashboard-header__left">
        {showMenuButton && (
          <button
            type="button"
            onClick={onMenuClick}
            className="dashboard-header__action dashboard-header__menu-button"
            title="Toggle sidebar (Ctrl+B)"
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={18} aria-hidden="true" />
          </button>
        )}

        <nav className="dashboard-header__crumbs" aria-label="Breadcrumb">
          <span className="dashboard-header__workspace">Workspace</span>
          <span className="dashboard-header__slash" aria-hidden="true">/</span>
          {crumbs.map((crumb, index) => {
            const isCurrent = index === crumbs.length - 1;
            return (
              <span key={`${crumb.label}-${crumb.href || "current"}`} className="dashboard-header__crumb-item">
                {index > 0 && <ChevronRight size={14} className="dashboard-header__crumb-sep" aria-hidden="true" />}
                {crumb.href && !isCurrent ? (
                  <Link href={crumb.href} className="dashboard-header__crumb">
                    {translate(crumb.label)}
                  </Link>
                ) : (
                  <span className="dashboard-header__current">
                    {crumb.image && (
                      <ProviderIcon
                        src={crumb.image}
                        alt={crumb.label}
                        size={22}
                        className="dashboard-header__current-icon"
                        fallbackText={crumb.label.slice(0, 2).toUpperCase()}
                      />
                    )}
                    <h1 className="dashboard-header__heading">{translate(crumb.label)}</h1>
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      </div>

      <div className="dashboard-header__actions">
        {contextualSearch ? (
          <HeaderSearch />
        ) : (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setActiveResult(0);
              setSearchOpen(true);
            }}
            className="dashboard-header__search-trigger"
            aria-label="Search pages"
            aria-haspopup="dialog"
          >
            <Search size={16} aria-hidden="true" />
            <span className="dashboard-header__search-label">Search pages...</span>
            <kbd className="dashboard-header__kbd">⌘K</kbd>
          </button>
        )}

        {dateText && <span className="dashboard-header__date">{dateText}</span>}

        <div className="dashboard-header__bell-wrap" ref={bellRef}>
          <button
            type="button"
            onClick={() => setBellOpen((value) => !value)}
            className="dashboard-header__action dashboard-header__bell"
            aria-label="Notifications"
            aria-expanded={bellOpen}
            title="Notifications"
          >
            <Bell size={18} aria-hidden="true" />
            {notifications.length > 0 && <span className="dashboard-header__dot" aria-hidden="true" />}
          </button>
          {bellOpen && (
            <div className="dashboard-header__popover" role="dialog" aria-label="Notifications">
              <p className="dashboard-header__popover-title">Notifications</p>
              {notifications.length > 0 ? (
                notifications.map((n) => (
                  <div key={n.id} className="dashboard-header__popover-item">
                    <div className="min-w-0">
                      {n.title ? <p className="dashboard-header__popover-heading">{n.title}</p> : null}
                      <p className="dashboard-header__popover-body">{n.message}</p>
                    </div>
                    {n.dismissible ? (
                      <button
                        type="button"
                        onClick={() => removeNotification(n.id)}
                        className="dashboard-header__popover-dismiss"
                        aria-label="Dismiss notification"
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="dashboard-header__popover-body">No notifications yet.</p>
              )}
            </div>
          )}
        </div>

        <HeaderMenu initials={initials} displayName={displayName} loginMethod={loginMethod} onLogout={handleLogout} />
      </div>

      {searchOpen && typeof document !== "undefined" && createPortal(
        <div className="dashboard-palette-layer">
          <div
            className="dashboard-palette__backdrop"
            onMouseDown={() => setSearchOpen(false)}
            aria-hidden="true"
          />
          <div className="dashboard-palette" role="dialog" aria-modal="true" aria-label="Search pages">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setActiveResult(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Jump to a page..."
              aria-label="Search pages"
              className="dashboard-palette__input"
            />
            <div className="dashboard-palette__results" role="listbox" aria-label="Pages">
              {searchResults.length > 0 ? (
                searchResults.map((entry, index) => (
                  <button
                    key={entry.href + entry.label}
                    type="button"
                    role="option"
                    aria-selected={index === activeResult}
                    onMouseEnter={() => setActiveResult(index)}
                    onClick={() => navigateTo(entry.href)}
                    className="dashboard-palette__option"
                  >
                    <Icon name={entry.icon} className="dashboard-palette__icon" aria-hidden="true" />
                    <span className="dashboard-palette__label">{entry.label}</span>
                    <ChevronRight size={16} className="dashboard-palette__chevron" aria-hidden="true" />
                  </button>
                ))
              ) : (
                <p className="dashboard-palette__empty">No page matches “{searchQuery.trim()}”.</p>
              )}
            </div>
            <p className="dashboard-palette__hint">Type to filter · Enter to open · Esc to close</p>
          </div>
        </div>,
        document.body,
      )}
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
      <Search
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none"
        aria-hidden="true"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="dashboard-header__search-input dashboard-header__search-input--contextual"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text)] p-0.5 rounded cursor-pointer"
          aria-label="Clear search"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

Header.propTypes = {
  onMenuClick: PropTypes.func,
  showMenuButton: PropTypes.bool,
};
