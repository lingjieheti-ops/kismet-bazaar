import type { Metadata, Viewport } from "next";
import { Playfair_Display, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KISMET — the parametric insurance bazaar",
  description:
    "Real rain pays real claims on Casper Testnet. AI syndicates price the risk, sell the cover, reinsure each other — and when one prices too bravely, the bell rings twice.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
