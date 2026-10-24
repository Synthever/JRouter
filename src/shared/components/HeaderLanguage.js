"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import PropTypes from "prop-types";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { onLocaleChange } from "@/i18n/runtime";
import LanguageSwitcher from "./LanguageSwitcher";
import { Languages } from "lucide-react";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function HeaderLanguage({ variant = "icon" }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const locale = useSyncExternalStore(onLocaleChange, getLocaleFromCookie, () => "en");

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className={variant === "menu" ? "dashboard-header__menu-item" : "dashboard-header__action"}
        title="Language"
        aria-label={`Language (${locale})`}
        data-i18n-skip="true"
      >
        {variant === "menu" ? (
          <>
            <Languages size={16} aria-hidden="true" />
            <span className="flex-1 text-left">Language</span>
            <span className="dashboard-header__locale">{locale.split("-")[0].toUpperCase()}</span>
          </>
        ) : (
          <span className="dashboard-header__locale">{locale.split("-")[0].toUpperCase()}</span>
        )}
      </button>

      <LanguageSwitcher
        hideTrigger
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

HeaderLanguage.propTypes = {
  variant: PropTypes.oneOf(["icon", "menu"]),
};
