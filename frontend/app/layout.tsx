import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LOKI",
  description: "GenLayer peer-to-peer prediction protocol",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
