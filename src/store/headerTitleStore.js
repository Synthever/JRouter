"use client";

import { create } from "zustand";

// Pages publish their own breadcrumb trail here; the shell header renders it
// verbatim. Keeping this generic means no route string lives in Header.js.
export const useHeaderTitleStore = create((set) => ({
  crumbs: [],
  setCrumbs: (crumbs) => set({ crumbs: Array.isArray(crumbs) ? crumbs : [] }),
  clearCrumbs: () => set({ crumbs: [] }),
}));
