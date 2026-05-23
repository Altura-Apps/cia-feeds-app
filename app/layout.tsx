import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CIAfeeds — Meta Catalog Feeds for Any Business",
  description: "Generate Meta-compatible catalog feed CSVs for automotive, real estate, and services",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
        {/* Global footer is intentionally omitted here.
            The marketing homepage (app/page.tsx) renders its own
            full-featured Footer component. Dashboard and auth pages
            are full-height panels that do not need a page footer.
            Add a footer to individual page layouts as needed. */}
      </body>
    </html>
  );
}
