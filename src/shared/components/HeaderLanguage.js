"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { onLocaleChange } from "@/i18n/runtime";
import LanguageSwitcher from "./LanguageSwitcher";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function HeaderLanguage() {
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
        className="dashboard-header__action"
        title="Language"
        aria-label={`Language (${locale})`}
        data-i18n-skip="true"
      >
        <span className="dashboard-header__locale">{locale.split("-")[0].toUpperCase()}</span>
      </button>

      <LanguageSwitcher
        hideTrigger
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
