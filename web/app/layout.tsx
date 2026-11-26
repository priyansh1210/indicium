import type { Metadata } from "next";
import { IBM_Plex_Mono, Public_Sans, Source_Serif_4 } from "next/font/google";

import { THEME } from "@/lib/theme";

import "./globals.css";

const sans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans" });
// The optical-size axis lets one serif set both a 104px headline and 16px clinical notes well.
const serif = Source_Serif_4({ subsets: ["latin"], axes: ["opsz"], variable: "--font-source-serif" });
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
    // The theme script sets data-theme on <html> before React sees it, hence the warning switch.
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
