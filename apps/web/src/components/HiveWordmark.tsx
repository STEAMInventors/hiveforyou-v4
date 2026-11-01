/* eslint-disable @next/next/no-img-element -- brand SVGs render at fixed sizes without optimization */
import Link from "next/link";

import { BRAND_ASSETS, BRAND_LOGO_SIZE } from "@/lib/brand-assets";

type HiveAppLogoProps = {
  linkHome?: boolean;
  display?: "lockup" | "responsive";
  size?: "header" | "landing" | "footer";
  href?: string;
  ariaLabel?: string;
  className?: string;
};

export function HiveAppLogo({
  linkHome = false,
  display = "responsive",
  size = "header",
  href = "/",
  ariaLabel = "HiveForYou home",
  className = "",
}: HiveAppLogoProps) {
  const heightPx =
    size === "landing"
      ? BRAND_LOGO_SIZE.landingHeaderHeightPx
      : size === "footer"
        ? BRAND_LOGO_SIZE.footerHeightPx
        : BRAND_LOGO_SIZE.headerHeightPx;

  const inner =
    display === "lockup" ? (
      <span className={`inline-flex items-center ${className}`.trim()}>
        <img
          src={BRAND_ASSETS.logo}
          alt="HiveForYou"
          style={{ height: heightPx, width: "auto" }}
          className="block"
        />
      </span>
    ) : (
      <span className={`inline-flex items-center ${className}`.trim()}>
        <img
          src={BRAND_ASSETS.logo}
          alt="HiveForYou"
          style={{ height: heightPx, width: "auto" }}
          className="hidden min-[400px]:block"
        />
        <img
          src={BRAND_ASSETS.mark}
          alt="HiveForYou"
          style={{ height: heightPx, width: heightPx }}
          className="block min-[400px]:hidden"
        />
      </span>
    );

  if (!linkHome) {
    return inner;
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="inline-flex shrink-0 rounded-md no-underline"
    >
      {inner}
    </Link>
  );
}

export function HiveBrandMark({
  variant = "standalone",
  className = "",
}: {
  variant?: "standalone" | "hero";
  className?: string;
}) {
  const size =
    variant === "hero"
      ? BRAND_LOGO_SIZE.markHeroPx
      : BRAND_LOGO_SIZE.markStandalonePx;
  return (
    <img
      src={BRAND_ASSETS.mark}
      alt=""
      aria-hidden
      style={{ width: size, height: size }}
      className={`block shrink-0 ${className}`.trim()}
    />
  );
}
