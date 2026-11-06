import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Outfit, Source_Serif_4 } from "next/font/google";

import { BRAND_ASSETS } from "@/lib/brand-assets";

import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-outfit",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-source-serif",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
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
