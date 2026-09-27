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
}: {
  logo: string;
  alt: string;
  variant?: "header" | "login";
}) {
  if (variant === "login") {
    // Deliberately a distinct class rather than reusing .login-v2-logo: that
    // rule paints a solid dark square for the "R" glyph, which would sit
    // behind the uploaded artwork.
    return logo
      ? <img src={logo} alt={alt} className="login-v2-logo-img" />
      : <span className="login-v2-logo">R</span>;
  }
  return logo
    ? <img src={logo} alt={alt} className="brand-logo" />
    : <span className="brand-letter">R</span>;
}
