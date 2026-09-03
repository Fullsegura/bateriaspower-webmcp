import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BateríasPower | Search-to-Sale",
  description: "Encuentra una batería compatible con ayuda de un agente WebMCP.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={geistSans.variable + " " + geistMono.variable}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
