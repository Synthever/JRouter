"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/shared/utils/cn";
import Sidebar from "../Sidebar";
import Header from "../Header";

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-[var(--line-2)] bg-[var(--surface)] text-[var(--pos)]",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-[var(--line-2)] bg-[var(--surface)] text-[var(--danger)]",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-[var(--line-2)] bg-[var(--surface)] text-[var(--warn)]",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-[var(--line-2)] bg-[var(--surface)] text-[var(--text)]",
    icon: "info",
  };
}

// Pages rendered on the dotted dashboard grid background.
const GRID_BACKGROUND_PAGES = [
  "/dashboard",
  "/dashboard/endpoint",
  "/dashboard/providers",
  "/dashboard/combos",
  "/dashboard/playground",
  "/dashboard/usage",
  "/dashboard/quota",
  "/dashboard/token-saver",
  "/dashboard/cli-tools",
  "/dashboard/skills",
];

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  // Restore collapsed preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("9router_sidebar_collapsed");
      if (saved === "true") {
        setDesktopSidebarCollapsed(true);
      }
    } catch {}
  }, []);

  const handleToggleSidebar = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen((v) => !v);
    } else {
      setDesktopSidebarCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem("9router_sidebar_collapsed", String(next));
        } catch {}
        return next;
      });
    }
  }, []);

  // Keyboard shortcut Ctrl+B or Cmd+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        // Skip if typing inside inputs or textareas
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleSidebar]);

  // Preload heavy usage charts in background when browser is idle
  useEffect(() => {
    const preload = () => {
      import("@/shared/components/UsageStats").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/UsageChart").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/ProviderBarChart").catch(() => {});
      import("@/app/(dashboard)/dashboard/usage/components/TopModelsChart").catch(() => {});
    };
    if (typeof window !== "undefined") {
      if ("requestIdleCallback" in window) {
        const id = window.requestIdleCallback(preload, { timeout: 4000 });
        return () => window.cancelIdleCallback(id);
      }
      const timer = setTimeout(preload, 2500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Chat-style pages own their full-height layout, scroll container and padding.
  const isFullHeightPage = pathname === "/dashboard/basic-chat" || pathname === "/dashboard/playground";
  const hasGridBackground = GRID_BACKGROUND_PAGES.includes(pathname) || pathname.startsWith("/dashboard/cli-tools/");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg">
      <div className="fixed top-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`rounded-[var(--r1)] border px-3 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur-sm ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                <Icon className="text-[18px] leading-5">{style.icon}</Icon>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5 text-[var(--text)]">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-wrap break-words text-[var(--text-2)]">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="text-current/70 hover:text-current"
                    aria-label="Dismiss notification"
                  >
                    <Icon className="text-[16px]">close</Icon>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <div
        className={cn(
          "hidden lg:flex transition-[width,opacity] duration-200 ease-in-out shrink-0 overflow-hidden",
          desktopSidebarCollapsed ? "w-0 opacity-0 pointer-events-none" : "w-60 opacity-100"
        )}
      >
        <Sidebar onToggleCollapse={handleToggleSidebar} isCollapsed={desktopSidebarCollapsed} />
      </div>

      {/* Sidebar - Mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform lg:hidden transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <main className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-150 isolate bg-bg">
        <Header
          key={pathname}
          onMenuClick={handleToggleSidebar}
          isSidebarCollapsed={desktopSidebarCollapsed}
        />
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${hasGridBackground ? "dashboard-grid-bg" : ""} ${isFullHeightPage ? "flex flex-col overflow-hidden" : "p-6 lg:p-8"}`}>
          <div className={isFullHeightPage ? "flex-1 w-full h-full flex flex-col" : "page"}>{children}</div>
        </div>
      </main>
    </div>
  );
}
