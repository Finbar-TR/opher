import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { PwaRegister } from "@/components/pwa-register";

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Opher — bulk-buy food together",
  description:
    "Join a food basket in your city, pay the bulk price, and get a fortnightly delivery. Free to cancel until your basket closes.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Opher", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#d6432c",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 pb-24 sm:px-6 sm:pb-8">
          {children}
        </main>
        <footer className="border-t border-line py-6 text-center text-sm text-soft">
          <p>Opher · bulk-buy food together</p>
          <p className="mt-2 flex justify-center gap-4">
            <a href="/privacy" className="hover:underline">Privacy</a>
            <a href="/terms" className="hover:underline">Terms</a>
            <a href="/cookies" className="hover:underline">Cookies</a>
          </p>
        </footer>
        <PwaRegister />
      </body>
    </html>
  );
}
