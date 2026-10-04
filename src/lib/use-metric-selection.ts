"use client";

/**
 * Ticking rows in a campaign table and acting on the selection: export or delete
 * in one request. Shared by /marketing and /metrics.
 *
 * /marketing grew this first, and /metrics then rendered the SAME rows through the
 * SAME `MARKETING_COLUMNS` registry while filtering the `select` column out of its
 * template — so it listed every campaign with no way to act on more than one at a
 * time. Two copies of this would leave two selection behaviours to keep in step, so
 * it lives here and both tables drive it.
 *
 * The page passes its currently-paged rows to `pageAllSelected` / `toggleSelectAll`
 * rather than the hook capturing them: "select all" means all rows ON SCREEN, and
 * the hook cannot know what the page is showing.
 */
import { useState } from "react";
import { apiErrorMessage } from "@/lib/api-errors";
import { downloadFile, exportQuery } from "@/lib/download";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Only the identity is needed, so any row shape works. */
export interface SelectableRow {
  id: string;
}

export interface MetricSelection {
  selectedIds: Set<string>;
  /** In flight for a bulk delete, so a second click cannot fire a second request. */
  deleting: boolean;
  toggleSelect: (id: string) => void;
  /** True when every row passed in is ticked — drives the header checkbox. */
  pageAllSelected: (rows: SelectableRow[]) => boolean;
  /** Ticks every row passed in, or unticks them if they are all ticked already. */
  toggleSelectAll: (rows: SelectableRow[]) => void;
  clearSelection: () => void;
  /** Exports exactly the ticked rows, ignoring the channel/date filters. */
  exportSelected: () => void;
  /** One request for the whole selection. Confirms first. */
  deleteSelected: () => Promise<void>;
}

export function useMetricSelection({
  t,
  reload,
}: {
  t: TFn;
  /** Re-reads the campaign rows; called after a successful delete. */
  reload: () => Promise<void>;
}): MetricSelection {
  /* Cross-PAGE rather than per-page: the point of ticking rows is to act on a
     specific set, which rarely fits inside one 25-row page. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Header checkbox: every row on the CURRENT page. Ticked again to un-tick. */
  const pageAllSelected = (rows: SelectableRow[]) =>
    rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  const toggleSelectAll = (rows: SelectableRow[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const ids = rows.map((r) => r.id);
      const remove = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (remove) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  /**
   * Exports exactly the ticked rows, ignoring the channel/date filters.
   *
   * The ids travel as a query param so the same endpoint still serves the
   * "Export Excel" button (which sends filters and no ids).
   */
  const exportSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    downloadFile(
      `/api/export/marketing${exportQuery({ ids: ids.join(",") })}`,
      `marketing-selected-${new Date().toISOString().slice(0, 10)}.xlsx`,
    ).catch(() => alert(t("mkt.exportFail")));
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || deleting) return;
    if (!confirm(t("mkt.deleteSelectedConfirm", { n: ids.length }))) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/marketing/metrics", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        // Neither page has a toast rail, so a failure has to be louder than the
        // silent reload it would otherwise fall through to.
        const err = await res.json().catch(() => ({}));
        alert(apiErrorMessage(t, (err as { error?: unknown })?.error) || t("mkt.deleteFailed"));
        return;
      }
      setSelectedIds(new Set());
      await reload();
    } finally {
      setDeleting(false);
    }
  };

  return {
    selectedIds,
    deleting,
    toggleSelect,
    pageAllSelected,
    toggleSelectAll,
    clearSelection,
    exportSelected,
    deleteSelected,
  };
}