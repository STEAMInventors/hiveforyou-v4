import type { Metadata } from "next";
import localFont from "next/font/local";

import { BRAND_ASSETS } from "@/lib/brand-assets";

import "./globals.css";

const outfit = localFont({
  src: [
    { path: "./fonts/outfit-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/outfit-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/outfit-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-outfit",
  display: "swap",
});

const dmSans = localFont({
  src: [
    { path: "./fonts/dm-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/dm-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

const sourceSerif = localFont({
  src: [
    { path: "./fonts/source-serif-4-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/source-serif-4-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/source-serif-4-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/source-serif-4-latin-500-italic.woff2", weight: "500", style: "italic" },
  ],
  variable: "--font-source-serif",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HiveForYou",
  description: "The complicated, made simple.",
  icons: {
    icon: [
      { url: BRAND_ASSETS.faviconSvg, type: "image/svg+xml" },
      { url: BRAND_ASSETS.faviconIco },
    ],
    apple: BRAND_ASSETS.appleTouchIcon,
  },
  openGraph: {
    images: [BRAND_ASSETS.ogImage],
  },
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${dmSans.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-paper font-sans text-ink">{children}</body>
    </html>
  );
}