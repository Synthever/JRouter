"use client";

import { APP_LOGO_URL } from "@/shared/constants/branding";

export default function AppLogo({ size = 36, className = "", alt = "" }) {
  return (
    <img
      src={APP_LOGO_URL}
      alt={alt}
      width={size}
      height={size}
      className={className}
      loading="eager"
      decoding="async"
    />
  );
}
