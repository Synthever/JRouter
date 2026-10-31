// Section metadata for /dashboard/profile. Pure data + one helper so both the
// chip toolbar and the scroll spy read from a single source.

export const PROFILE_SECTIONS = [
  {
    id: "profile-preferences",
    label: "Preferences",
    icon: "settings",
    title: "Preferences & data",
    description: "Display preferences and database backups.",
  },
  {
    id: "profile-security",
    label: "Security",
    icon: "shield",
    title: "Security",
    description: "Dashboard access and password management.",
  },
  {
    id: "profile-sso",
    label: "SSO",
    icon: "lock_open",
    title: "Single Sign-On (SSO)",
    description: "Optional SSO via Okta, Entra ID, Keycloak, or OIDC.",
  },
  {
    id: "profile-routing",
    label: "Routing",
    icon: "route",
    title: "Routing Strategy",
    description: "Account and combo rotation preferences.",
  },
  {
    id: "profile-network",
    label: "Network",
    icon: "wifi",
    title: "Network",
    description: "Outbound connections for OAuth and provider requests.",
  },
  {
    id: "profile-observability",
    label: "Observability",
    icon: "monitoring",
    title: "Observability",
    description: "Request logging for the logs view.",
  },
  {
    id: "profile-session",
    label: "Session",
    icon: "logout",
    title: "Session & server",
    description: "Dashboard session and the proxy process.",
  },
];

/**
 * Picks the section currently under the reading line.
 * `offsets` must be in document order; `line` is the scroll offset that counts
 * as "read" (the sticky toolbar height).
 */
export function activeSectionId(offsets, line = 0) {
  if (!Array.isArray(offsets) || offsets.length === 0) return null;
  let active = offsets[0].id;
  for (const entry of offsets) {
    if (entry.top <= line) active = entry.id;
  }
  return active;
}
