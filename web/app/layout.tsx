import type { Metadata } from "next";
import { IBM_Plex_Mono, Public_Sans, Source_Serif_4 } from "next/font/google";

import "./globals.css";

const sans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: { default: "Indicium", template: "%s · Indicium" },
  description: "Prior-authorization review: every criterion points at its evidence.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
