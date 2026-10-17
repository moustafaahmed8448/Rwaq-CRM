import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  /* Neutral pre-hydration fallback only: the tenant's actual name is written to
     document.title by useBrand() once the Setting row loads (see src/lib/brand.ts),
     so keeping "Rwaq" here would flash the original brand on every white-labeled
     workspace during first paint. */
  title: "CRM",
  description: "Weekly marketing ROI and CRM workflow dashboard",
};

/* themeColor is a VIEWPORT field, not a metadata one — Next 16 prints
   "Unsupported metadata themeColor is configured in metadata export" and drops
   the meta tag when it lives in `metadata`. Matches --navy so the browser
   chrome (address bar, notch) blends with the dark theme's base rather than
   flashing a separate grey. */
export const viewport: Viewport = {
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
