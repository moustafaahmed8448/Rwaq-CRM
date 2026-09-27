"use client";

/**
 * The brand mark: the admin-uploaded logo when one exists, otherwise the
 * original "R" badge. Presentational on purpose — the caller owns `useLogo()` so
 * a page only fetches the logo once no matter how many marks it renders.
 */
export default function BrandMark({
  logo,
  alt,
  variant = "header",
  size = "sm",
}: {
  logo: string;
  alt: string;
  variant?: "header" | "login";
  /**
   * "lg" is for the mark that sits above the "Welcome back" heading; "sm" is
   * the corner badge. The modifier is applied to BOTH the uploaded logo and the
   * "R" fallback, so the card keeps the same footprint whether or not a logo
   * has been set.
   */
  size?: "sm" | "lg";
}) {
  const mod = size === "lg" ? " is-lg" : "";
  if (variant === "login") {
    // Deliberately a distinct class rather than reusing .login-v2-logo: that
    // rule paints a solid dark square for the "R" glyph, which would sit
    // behind the uploaded artwork.
    return logo
      ? <img src={logo} alt={alt} className={`login-v2-logo-img${mod}`} />
      : <span className={`login-v2-logo${mod}`}>R</span>;
  }
  return logo
    ? <img src={logo} alt={alt} className={`brand-logo${mod}`} />
    : <span className={`brand-letter${mod}`}>R</span>;
}
