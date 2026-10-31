"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads instance settings once and exposes the shared setter.
 *
 * The optional `onLoaded` callback receives the same payload at the same time
 * the hook stores it, so a caller that keeps editable copies of some fields
 * (the page's SSO and proxy forms) can hydrate them without a second request
 * or a state-syncing effect.
 */
export function useProfileSettings(onLoaded) {
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError("");
    return fetch("/api/settings")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const next = data || {};
        setSettings(next);
        onLoadedRef.current?.(next);
        return next;
      })
      .catch(() => {
        setLoadError("Could not load your instance settings. Try again.");
        return null;
      })
      .finally(() => setLoading(false));
  }, []);

  // Kick off the first load. `reload` only changes state from its fetch
  // callbacks; the two setters it runs up front re-assert the initial values,
  // so mounting does not cascade a render. The new React lint cannot see that.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  return { settings, setSettings, loading, loadError, reload };
}
