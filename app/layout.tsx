import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "Clear Skies — Historical AQI",
  description: "Explore historical U.S. Air Quality Index data with transparent geographic sourcing.",
  icons: { icon: "/favicon.svg" },
  openGraph: { title: "Clear Skies", description: "Historical U.S. Air Quality", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "Clear Skies", images: ["/og.png"] },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>; }
