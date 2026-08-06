import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host")?.split(":")[0].toLowerCase();
  const origin = host === "airthen.info" ? "https://airthen.info" : "https://airthen.com";
  const description = "Explore historical air quality for U.S. cities and metro areas.";
  return {
    metadataBase: new URL(origin),
    title: "AirThen — Historical air quality",
    description,
    alternates: { canonical: origin },
    icons: { icon: "/airthen-mark.svg" },
    openGraph: {
      type: "website",
      url: origin,
      siteName: "AirThen",
      title: "AirThen — Historical air quality",
      description,
      images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "AirThen — Historical air quality" }],
    },
    twitter: { card: "summary_large_image", title: "AirThen — Historical air quality", description, images: [`${origin}/og.png`] },
  };
}
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>; }
