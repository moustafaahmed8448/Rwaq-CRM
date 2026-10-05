"use client";

/**
 * Saved filter views for the clients screen, plus a row of one-click quick views.
 *
 * Two separate ideas sharing one strip, deliberately:
 *
 *   - Quick views are FIXED and built in ("Overdue", "Due today"). They cost
 *     nothing to offer and answer the questions asked every morning, so they are
 *     always visible.
 *   - Saved views are the user's own. Saving exists because re-clicking five
 *     dropdowns to answer a question you ask daily is pure friction, and because
 *     the filter state lives in React and is lost on reload.
 *
 * Restoring a view REPLACES the filter state rather than merging into it: applying
 * "Overdue" on top of "Riyadh + Lost" is never what someone means when they click
 * a view named "Overdue".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Check, Plus, X } from "lucide-react";
import type { Filters } from "@/lib/client-types";
import type { SavedView, SavedViewFilters } from "@/lib/db";
import type { TFn } from "@/lib/client-types";

/** The built-in quick views. Every one maps onto an existing filter dimension —
 *  nothing here needs a new query parameter or a server change. */
const QUICK: { key: string; filters: Partial<Filters> }[] = [
  { key: "views.overdue", filters: { followUp: "overdue" } },
  { key: "views.today", filters: { followUp: "today" } },
  { key: "views.upcoming", filters: { followUp: "upcoming" } },
  { key: "views.noFollowUp", filters: { followUp: "none" } },
];

export default function SavedViewsBar({
  filters,
  onApply,
  t,
}: {
  filters: Filters;
  onApply: (next: Filters) => void;
  t: TFn;
}) {
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/views", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const d = (await res.json()) as { views?: SavedView[] };
      setViews(d.views ?? []);
    } catch {
      // Left null so the bar renders as "unavailable" rather than as an empty
      // list, which would look like the user has no saved views.
      setViews([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  const blank = (): Filters => ({
    query: "",
    status: [],
    channel: [],
    location: [],
    firstContact: [],
    secondContact: [],
    followUp: "",
    startDate: "",
    endDate: "",
  });

  const apply = (patch: Partial<Filters>, id?: string) => {
    onApply({ ...blank(), ...patch });
    setActiveId(id ?? null);
  };

  const applySaved = (view: SavedView) => {
    // Every key is defaulted through `blank()` first, so a saved view that omits
    // (say) `location` CLEARS it rather than leaving whatever was on screen.
    apply({ ...view.filters } as Partial<Filters>, view.id);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Every key sent explicitly, including the empty ones. Omitting them
        // would store a sparse view whose restore silently keeps old filters.
        body: JSON.stringify({
          name: trimmed,
          filters: {
            query: filters.query,
            status: filters.status,
            channel: filters.channel,
            location: filters.location,
            firstContact: filters.firstContact,
            secondContact: filters.secondContact,
            followUp: filters.followUp,
            startDate: filters.startDate,
            endDate: filters.endDate,
          } satisfies SavedViewFilters,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const d = (await res.json()) as { views?: SavedView[] };
      setViews(d.views ?? []);
      setNaming(false);
      setName("");
      setActiveId(d.views?.find((v) => v.name === trimmed)?.id ?? null);
    } catch {
      setError(t("views.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/views", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        const d = (await res.json()) as { views?: SavedView[] };
        setViews(d.views ?? []);
        if (activeId === id) setActiveId(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="views-bar">
      <span className="views-label">
        <Bookmark size={13} />{t("views.label")}
      </span>

      {QUICK.map((q) => (
        <button
          key={q.key}
          type="button"
          className={`view-chip ${filters.followUp === q.filters.followUp ? "view-chip-active" : ""}`}
          onClick={() => apply(q.filters)}
        >
          {t(q.key)}
        </button>
      ))}

      <span className="views-divider" role="separator" />

      {/* Saved views are optional. The bar renders without them � an account that
          has never saved one is the normal case on day one, and an empty section
          headed "Saved views" would just be noise. */}
      {views?.map((v) => (
        <span key={v.id} className="view-chip-wrap">
          <button
            type="button"
            className={`view-chip ${activeId === v.id ? "view-chip-active" : ""}`}
            onClick={() => applySaved(v)}
            title={t("views.apply", { name: v.name })}
          >
            {activeId === v.id && <Check size={11} />}
            {v.name}
          </button>
          <button
            type="button"
            className="view-chip-remove"
            onClick={() => void remove(v.id)}
            title={t("views.remove")}
            aria-label={t("views.remove")}
          >
            <X size={10} />
          </button>
        </span>
      ))}

      {naming ? (
        <span className="view-naming">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") { setNaming(false); setName(""); }
            }}
            placeholder={t("views.namePh")}
            aria-label={t("views.namePh")}
            maxLength={60}
          />
          <button className="btn-sm" onClick={() => void save()} disabled={!name.trim() || busy}>
            <Check size={12} />{t("common.save")}
          </button>
          <button className="btn-ghost" onClick={() => { setNaming(false); setName(""); setError(""); }}>
            <X size={12} />
          </button>
          {error && <em className="view-error">{error}</em>}
        </span>
      ) : (
        <button type="button" className="view-chip view-chip-add" onClick={() => setNaming(true)}>
          <Plus size={12} />{t("views.save")}
        </button>
      )}
    </div>
  );
}
