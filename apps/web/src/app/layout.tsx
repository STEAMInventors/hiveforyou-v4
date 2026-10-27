import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Outfit, Source_Serif_4 } from "next/font/google";

import { AppHeader } from "@/components/app-header";

import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HiveForYou",
  description: "The complicated, made simple.",
};

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
      <body>
        <AppHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
