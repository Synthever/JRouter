"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useTheme } from "@/shared/hooks/useTheme";
import ChangelogModal from "./ChangelogModal";
import { ConfirmModal } from "./Modal";
import { History, LogOut, Moon, Power, Sun } from "lucide-react";
import HeaderLanguage from "./HeaderLanguage";

function MenuItem({ icon: IconComponent, label, onClick, trailing, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`dashboard-header__menu-item ${danger ? "is-danger" : ""}`}
    >
      <IconComponent size={16} aria-hidden="true" />
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.elementType.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout, initials = "JR", displayName = "", loginMethod = "" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const { toggleTheme, isDark } = useTheme();
  const menuRef = useRef(null);

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

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && !changelogOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        setChangelogOpen(false);
        menuRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, changelogOpen]);

  const close = () => setIsOpen(false);

  return (
    <>
      <div className="dashboard-header__menu relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="dashboard-header__avatar"
          title={displayName || "Account"}
          aria-label="Account menu"
          aria-expanded={isOpen}
        >
          <span>{initials}</span>
        </button>

        {isOpen && (
          <div className="dashboard-header__dropdown absolute right-0 top-full mt-2 w-60 z-50 overflow-hidden p-1">
            {displayName ? (
              <div className="dashboard-header__account">
                <strong>{displayName}</strong>
                {loginMethod ? <span>{loginMethod}</span> : null}
              </div>
            ) : null}
            <HeaderLanguage variant="menu" />
            <MenuItem
              icon={History}
              label="Change Log"
              onClick={() => { close(); setChangelogOpen(true); }}
            />
            <MenuItem
              icon={isDark ? Sun : Moon}
              label="Theme"
              onClick={() => { toggleTheme(); close(); }}
            />
            <MenuItem
              icon={Power}
              label="Shutdown"
              danger
              onClick={() => { close(); setShutdownOpen(true); }}
            />
            <MenuItem
              icon={LogOut}
              label="Logout"
              danger
              onClick={() => { close(); onLogout(); }}
            />
          </div>
        )}
      </div>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <ConfirmModal
        isOpen={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />
    </>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
  initials: PropTypes.string,
  displayName: PropTypes.string,
  loginMethod: PropTypes.string,
};
