"use client";

import { useCallback } from "react";

/**
 * Optimistically flips every connection of a provider, then persists each one.
 * Shared by the media listing pages.
 */
export default function useProviderToggle(connections, setConnections) {
  return useCallback(
    async (providerId, newActive) => {
      const targets = connections.filter((c) => c.provider === providerId);
      setConnections((prev) =>
        prev.map((c) => (c.provider === providerId ? { ...c, isActive: newActive } : c))
      );
      await Promise.allSettled(
        targets.map((c) =>
          fetch(`/api/providers/${c.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: newActive }),
          })
        )
      );
    },
    [connections, setConnections]
  );
}
