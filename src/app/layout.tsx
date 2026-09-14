import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rwaq Marketing Dashboard",
  description: "Weekly marketing ROI and CRM workflow dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
