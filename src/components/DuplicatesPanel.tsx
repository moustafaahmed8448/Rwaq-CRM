"use client";

/**
 * Duplicate review: groups of clients that share an identifying value.
 *
 * The two reasons are NOT the same kind of finding and are never presented as
 * one. `phone` means the same person, digits-for-digits. `name` only means the
 * same name — and in a book whose rows are largely first names and kunyas
 * ("فهد", "ابو خالد"), a shared name is usually several DIFFERENT people. So the
 * name groups are labelled as a prompt to review, no row is pre-selected as the
 * survivor, and the differing fields are shown side by side so the decision is
 * made on evidence rather than on a button's default.
 *
* Nothing merges without an explicit choice plus a confirmation that names the
  * rows being removed. A merge archives records; that must never be one click.
  */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, GitMerge, Loader2, Phone, UserRound, X as XIcon } from "lucide-react";
import StatusPill from "@/components/StatusPill";
import { dateLocale } from "@/lib/format";
import type { TFn } from "@/lib/client-types";

type Row = {
  id: string;
  name: string;
  phoneNumber: string;
  status: string;
  project: string;
  location: string;
  acquisitionChannel: string;
  operationToTake: string;
  firstContactPerson: string;
  secondContactPerson: string;
  notes?: string;
  nextFollowUpAt?: string | null;
  createdAt?: string;
};

type Group = { reason: "phone" | "name"; key: string; clients: Row[] };

/** Fields compared across a group; a mismatch is what makes two rows distinct. */
const COMPARE = [
  "phoneNumber",
  "status",
  "project",
  "location",
  "acquisitionChannel",
  "firstContactPerson",
  "secondContactPerson",
] as const;

export default function DuplicatesPanel({
  onClose,
  onMerged,
  isAdmin,
  t,
  lang,
}: {
  onClose: () => void;
  /** Lets the host refresh its client list after a merge. */
  onMerged?: () => void;
  /** Only admins may execute a merge; standard users can view but not act. */
  isAdmin: boolean;
  t: TFn;
  lang: string;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Which row in each group the user picked to KEEP, keyed by group key.
  const [keep, setKeep] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/duplicates", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const d = (await res.json()) as { groups?: Group[] };
      setGroups(d.groups ?? []);
    } catch {
      setError(t("dupes.failed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const merge = async (group: Group) => {
    if (!isAdmin) return;
    const primaryId = keep[groupKey(group)];
    if (!primaryId || busy) return;
    const sources = group.clients.filter((c) => c.id !== primaryId).map((c) => c.id);
    const primary = group.clients.find((c) => c.id === primaryId)!;
    // Names the rows that will be REMOVED, so the confirmation is concrete.
    if (
      !confirm(
        t("dupes.confirm", {
          keep: primary.name,
          remove: group.clients
            .filter((c) => c.id !== primaryId)
            .map((c) => `#${c.id} ${c.name}`)
            .join("، "),
        }),
      )
    ) {
      return;
    }
    setBusy(groupKey(group));
    setError("");
    try {
      const res = await fetch("/api/crm/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryId, sourceIds: sources }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        setError(String(body.error ?? t("dupes.mergeFailed")));
        return;
      }
      // Re-read rather than splicing locally: the merge rewrites the survivor's
      // fields, and leaving the stale copy on screen would show values that no
      // longer exist.
      await load();
      onMerged?.();
    } catch {
      setError(t("dupes.mergeFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel dupes-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("dupes.title")}>
        <div className="detail-header">
          <div>
            <div className="breadcrumb"><GitMerge size={14} />{t("dupes.title")}</div>
            <h2>{t("dupes.heading")}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            <XIcon size={18} />
          </button>
        </div>

        <div className="detail-body">
          {error && <div className="settings-error">{error}</div>}
          {groups === null && !error && (
            <div className="empty-state">
              <Loader2 size={16} className="imp-spin" /> {t("common.loading")}
            </div>
          )}
          {groups !== null && groups.length === 0 && (
            <div className="empty-state">{t("dupes.none")}</div>
          )}

          {/* The one thing a user must understand before merging anything here. */}
          {groups !== null && groups.some((g) => g.reason === "name") && (
            <p className="dupes-note">
              <AlertTriangle size={13} /> {t("dupes.nameWarning")}
            </p>
          )}

          {groups?.map((group) => {
            const key = groupKey(group);
            const chosen = keep[key] ?? "";
            // Fields on which the rows actually disagree — these are what tells
            // the user the records are NOT interchangeable.
            const differing = COMPARE.filter((f) => {
              const values = new Set(group.clients.map((c) => String(c[f] ?? "").trim()));
              return values.size > 1;
            });
            return (
              <section key={key} className={`dupes-group dupes-${group.reason}`}>
                <header className="dupes-group-head">
                  {group.reason === "phone" ? <Phone size={13} /> : <UserRound size={13} />}
                  <span className="dupes-reason">{t(`dupes.reason.${group.reason}`)}</span>
                  <span className="dupes-key" dir={group.reason === "phone" ? "ltr" : undefined}>{group.key}</span>
                  <span className="dupes-count">{t("dupes.groupSize", { n: group.clients.length })}</span>
                </header>

                <div className="dupes-rows">
                  {group.clients.map((c) => (
                    <label key={c.id} className={`dupes-row ${chosen === c.id ? "dupes-row-keep" : ""}`}>
                      <input
                        type="radio"
                        name={`keep-${key}`}
                        checked={chosen === c.id}
                        onChange={() => setKeep((prev) => ({ ...prev, [key]: c.id }))}
                      />
                      <span className="dupes-row-main">
                        {/* One head line: name grows and ellipsizes, the status pill
                            and the open button sit pinned to its end. Previously the
                            pill and button were siblings of this whole column, so the
                            wrapped field list competed with them for width and the
                            row read as cramped and misaligned. */}
                        <span className="dupes-row-head">
                          <b>
                            <span className="linked-id">#{c.id}</span>
                            {c.name}
                          </b>
                          <StatusPill status={c.status} t={t} variant="badge" />
                          <button
                            type="button"
                            className="icon-btn-sm"
                            title={t("detail.timeline")}
                            onClick={(e) => {
                              e.preventDefault();
                              router.push(`/clients/${c.id}`);
                            }}
                          >
                            <ArrowUpRight size={13} />
                          </button>
                        </span>
                        <span className="dupes-row-fields">
                          {COMPARE.map((f) => (
                            <span key={f} className={differing.includes(f) ? "dupe-differs" : undefined}>
                              <em>{t(`dupes.field.${f}`)}</em>
                              {String(c[f] ?? "") || "—"}
                            </span>
                          ))}
                        </span>
                        {c.nextFollowUpAt && (
                          <span className="dupes-row-extra">
                            {t("form.nextFollowUp")}:{" "}
                            {new Date(c.nextFollowUpAt).toLocaleDateString(dateLocale(lang))}
                          </span>
                        )}
                        {c.notes && <span className="dupes-row-extra">{c.notes.slice(0, 120)}</span>}
                      </span>
                    </label>
                  ))}
                </div>

                <footer className="dupes-group-foot">
                  <span className="muted">{t("dupes.keepHint")}</span>
                  <button
                    className="btn-primary"
                    disabled={!chosen || busy === key || !isAdmin}
                    title={isAdmin ? undefined : t("errors.adminOnly")}
                    onClick={() => void merge(group)}
                  >
                    {busy === key ? <Loader2 size={13} className="imp-spin" /> : <GitMerge size={13} />}
                    {t("dupes.merge")}
                  </button>
                </footer>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Stable identity for a group: the reason plus the value it matched on. */
function groupKey(group: Group): string {
  return `${group.reason}:${group.key}`;
}
