import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codice",
  description: "Browser-based tool that turns project folders into polished DOCX, PDF, and ODT documents. Local-first, no telemetry.",
  keywords: ["Codice", "DOCX", "PDF", "ODT", "syntax highlighting", "source code", "documentation", "code", "document"],
  authors: [{ name: "Codice" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Codice",
    description: "Turn project folders into polished documents — 100% client-side.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
