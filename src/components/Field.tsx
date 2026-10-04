"use client";

/**
 * A labelled form control, optionally spanning the whole grid and showing one
 * error line underneath.
 *
 * Extracted because it existed as two near-identical private copies — one in
 * src/app/page.tsx (without `error`) and one in src/app/marketing/page.tsx (with
 * it) — and the campaign form is now shared by /marketing and /metrics, which
 * would otherwise have meant a third copy to keep in step with every
 * `.field-invalid` / `.field-error` style change.
 */
export default function Field({
  label,
  wide,
  error,
  children,
}: {
  label: string;
  wide?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`field${wide ? " field-wide" : ""}${error ? " field-invalid" : ""}`}>
      <span>{label}</span>
      {children}
      {error && <em className="field-error">{error}</em>}
    </label>
  );
}