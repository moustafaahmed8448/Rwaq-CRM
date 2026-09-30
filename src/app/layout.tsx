import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rwaq Marketing Dashboard",
  description: "Weekly marketing ROI and CRM workflow dashboard",
  // Matches --navy so the browser chrome (address bar, notch) blends with the
  // dark theme's base rather than flashing a separate grey.
  themeColor: "#13223C",
};

/**
 * The glass backdrop the whole design refracts.
 *
 * `backdrop-filter` needs something behind it to blur — against a flat
 * `--paper` the panels read as plain grey. This fixed gradient mesh is that
 * layer, mounted once at the root rather than per page. It is decorative and
 * non-interactive (`pointer-events: none`, `z-index: -1`), and carries
 * `aria-hidden` so it never reaches assistive tech.
 */
function GlassBackdrop() {
  return <div className="glass-backdrop" aria-hidden="true" />;
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
        <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <GlassBackdrop />
        {children}
      </body>
    </html>
  );
}
