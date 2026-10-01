"use client";

/**
 * Status badge, coloured from the pipeline registry.
 *
 * The markup used to be `className={status-${status.toLowerCase()}}` with CSS
 * written for only three hardcoded values. Every stage added to the registry
 * therefore rendered with no background and no colour, and the kanban built its
 * dot class the same way — a naming convention that structurally cannot know
 * about a new stage. Deriving the tint from the stage accent makes that class
 * of bug impossible.
 *
 * The alpha suffix is appended to the hex accent to produce a wash for the
 * background while the full colour is used for the text.
 */
import { statusLabel, type TranslateFn } from "@/lib/reporting";
import { useOptionColors } from "@/lib/option-colors";
import { optionColor } from "@/lib/ref-options";

export default function StatusPill({
  status,
  t,
  variant = "pill",
  style,
}: {
  status: string;
  t: TranslateFn;
  variant?: "pill" | "badge";
  style?: React.CSSProperties;
}) {
  const colors = useOptionColors();
  const color = optionColor("statuses", status, colors);
  const label = statusLabel(t, status);
  const cls = variant === "badge" ? "status-badge" : "status-pill";
  return (
    <span className={cls} style={{ background: color + "1f", color, ...style }}>
      {label}
    </span>
  );
}

/** The round colour chip used on kanban column headers. */
export function StatusDot({ status }: { status: string }) {
  const colors = useOptionColors();
  return <span className="kanban-dot" style={{ background: optionColor("statuses", status, colors) }} />;
}
