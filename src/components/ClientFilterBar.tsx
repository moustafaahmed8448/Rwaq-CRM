"use client";

/**
 * The clients filter bar: search, the five multi-selects, the follow-up bucket
 * chips, the date presets and the removable chips row.
 *
 * Extracted from src/app/page.tsx so the profile page can render the IDENTICAL bar
 * rather than a lookalike that drifts from it. Everything it needs arrives as a
 * prop; it holds no state of its own beyond what the host owns.
 */
import { Filter, Search } from "lucide-react";
import MultiSelect from "@/components/MultiSelect";
import Select from "@/components/Select";
import { num } from "@/lib/format";
import { channelLabel, locationLabel, statusLabel } from "@/lib/reporting";
import { useStatusLabels } from "@/lib/status-labels";
import {
  FOLLOW_UP_BUCKETS,
  SORT_LABELS,
  type DatePreset,
  type Filters,
  type SortField,
  type TFn,
} from "@/lib/client-types";

export default function FilterBar({ filters, updateFilter, setMultiFilter, followUp, setFollowUp, followUpCounts, clearAllFilters, firstContacts, secondContacts, datePresets, activeDatePreset, applyDatePreset, clearDatePreset, sortBy, setSortBy, filterCount, allStatuses, allChannels, allLocations, onRemoveStatus, onRemoveChannel, onRemoveLocation, removableStatuses, removableChannels, removableLocations, statusUsage, channelUsage, locationUsage, t }: {
  filters: Filters;
  updateFilter: (k: "query" | "startDate" | "endDate", v: string) => void;
  setMultiFilter: (k: "status" | "channel" | "location" | "firstContact" | "secondContact", values: string[]) => void;
  /** Active follow-up bucket, or "" for none. */
  followUp: string;
  /** Toggles a bucket; passing the active one again clears it. */
  setFollowUp: (value: string) => void;
  /**
   * How many clients each bucket holds, under the filters currently applied.
   *
   * The badge is the whole point: a chip that shows nothing beside "Overdue" is
   * indistinguishable from one that is not filtering, which is how a filter with
   * nothing to match reads as a broken filter. Omitted while loading or when the
   * host does not ask for them.
   */
  followUpCounts?: Partial<Record<string, number>>;
  clearAllFilters: () => void;
  /** Distinct names per contact role, filtered independently. */
  firstContacts: string[];
  secondContacts: string[];
  datePresets?: DatePreset[];
  activeDatePreset?: string | null;
  applyDatePreset?: (p: DatePreset) => void;
  clearDatePreset?: () => void;
  sortBy?: SortField;
  setSortBy?: (s: SortField) => void;
  filterCount?: number;
  allStatuses?: string[];
  allChannels?: string[];
  allLocations?: string[];
  onRemoveStatus?: (value: string) => void;
  onRemoveChannel?: (value: string) => void;
  onRemoveLocation?: (value: string) => void;
  removableStatuses?: string[];
  removableChannels?: string[];
  removableLocations?: string[];
  statusUsage?: Record<string, number>;
  channelUsage?: Record<string, number>;
  locationUsage?: Record<string, number>;
  t: TFn;
}) {
  // Admin-set display names, so the status dropdown and the removable filter
  // chips say what the admin renamed a stage to rather than its built-in name.
  const statusLabels = useStatusLabels();
  const hasPreset = activeDatePreset || filters.startDate || filters.endDate;
  return (
    <>
      {datePresets && datePresets.length > 0 && (
        <div className="date-presets">
          {datePresets.map(p => (
            <button key={p.label} className={`date-preset-btn ${activeDatePreset === p.label ? 'active' : ''}`}
              onClick={() => applyDatePreset!(p)}>{t(p.label)}</button>
          ))}
          {hasPreset && <button className="date-preset-btn" onClick={clearDatePreset}>{t("filter.clear")}</button>}
        </div>
      )}
      <div className="filter-row filter-row--bar">
        <div className="search-box"><Search size={15} /><input placeholder={t("filter.queryPh")} value={filters.query} onChange={e => updateFilter("query", e.target.value)} /></div>
        <MultiSelect label={t("filter.allStatuses")} options={allStatuses ?? []} selected={filters.status} onChange={v => setMultiFilter("status", v)} render={v => statusLabel(t, v, statusLabels)} onRemove={onRemoveStatus} removable={removableStatuses} removeUsage={statusUsage} t={t} />
        <MultiSelect label={t("filter.allChannels")} options={allChannels ?? []} selected={filters.channel} onChange={v => setMultiFilter("channel", v)} render={v => channelLabel(t, v)} onRemove={onRemoveChannel} removable={removableChannels} removeUsage={channelUsage} t={t} />
        <MultiSelect label={t("filter.allLocations")} options={allLocations ?? []} selected={filters.location} onChange={v => setMultiFilter("location", v)} render={v => locationLabel(t, v)} onRemove={onRemoveLocation} removable={removableLocations} removeUsage={locationUsage} t={t} />
        {/* 1st and 2nd contact are separate dropdowns, and they AND together:
            picking one of each narrows to that exact pairing. */}
        <MultiSelect label={t("filter.firstContact")} options={firstContacts} selected={filters.firstContact} onChange={v => setMultiFilter("firstContact", v)} t={t} />
        <MultiSelect label={t("filter.secondContact")} options={secondContacts} selected={filters.secondContact} onChange={v => setMultiFilter("secondContact", v)} t={t} />
        {/* Follow-up buckets as four toggle chips rather than a dropdown: they are
            the questions actually asked during a day ("what did I miss?", "what's
            on today?"), and one click should answer them. Re-clicking the active
            one clears it, so the same control doubles as its own off switch. The
            count beside each label is what proves the filter is live — and when a
            bucket is legitimately empty, it says so instead of looking broken. */}
        <div className="followup-filter" role="group" aria-label={t("th.followUp")}>
          {FOLLOW_UP_BUCKETS.map(b => (
            <button
              key={b}
              type="button"
              className={`followup-chip${followUp === b ? " active" : ""}${b === "overdue" ? " is-overdue" : ""}`}
              aria-pressed={followUp === b}
              onClick={() => setFollowUp(b)}
            >
              {t(`followUp.${b}`)}
              {followUpCounts?.[b] !== undefined && (
                <span className="followup-chip-count">{num(followUpCounts[b] as number)}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="date-bar">
        <Filter size={13} /><span>{t("th.date")}</span><input type="date" value={filters.startDate} onChange={e => updateFilter("startDate", e.target.value)} /><span>–</span><input type="date" value={filters.endDate} onChange={e => updateFilter("endDate", e.target.value)} />
        {setSortBy && sortBy && (
          <label className="sort-picker">
            <span>{t("clients.sortBy")}</span>
            <Select
              value={sortBy}
              options={Object.keys(SORT_LABELS)}
              onChange={v => setSortBy!(v as SortField)}
              render={v => t(SORT_LABELS[v] ?? v)}
              searchable={false}
              closeOnSelect={false}
              t={t}
            />
          </label>
        )}
      </div>
      {(filterCount ?? 0) > 0 && (
        <div className="filter-chips">
          {filters.query && <span className="filter-chip">&ldquo;{filters.query.slice(0, 24)}&rdquo;<button title={t("common.clear")} onClick={() => updateFilter("query", "")}>×</button></span>}
          {filters.status.map(s => <span key={`st-${s}`} className="filter-chip">{statusLabel(t, s, statusLabels)}<button onClick={() => setMultiFilter("status", filters.status.filter(x => x !== s))}>×</button></span>)}
          {filters.channel.map(c => <span key={`ch-${c}`} className="filter-chip">{channelLabel(t, c)}<button onClick={() => setMultiFilter("channel", filters.channel.filter(x => x !== c))}>×</button></span>)}
          {filters.location.map(l => <span key={`lo-${l}`} className="filter-chip">{l}<button onClick={() => setMultiFilter("location", filters.location.filter(x => x !== l))}>×</button></span>)}
          {filters.firstContact.map(p => <span key={`fc-${p}`} className="filter-chip">{t("filter.firstContact")}: {p}<button onClick={() => setMultiFilter("firstContact", filters.firstContact.filter(x => x !== p))}>×</button></span>)}
          {filters.secondContact.map(p => <span key={`sc-${p}`} className="filter-chip">{t("filter.secondContact")}: {p}<button onClick={() => setMultiFilter("secondContact", filters.secondContact.filter(x => x !== p))}>×</button></span>)}
          {/* The follow-up bucket was the one filter with no chip here, so picking
              "Overdue" left the row silently empty for that filter: the toggle
              button itself turns active, but there was no removable tag saying so.
              Ordered with the contact chips because that is where it counts in
              filterCount. `setFollowUp("")` is the explicit clear — the prop is a
              toggle, and an empty value never equals the active bucket, so this
              can only ever clear, never re-select. */}
          {followUp && <span className="filter-chip">{t(`followUp.${followUp}`)}<button title={t("common.clear")} onClick={() => setFollowUp("")}>×</button></span>}
          {filters.startDate && <span className="filter-chip">{t("common.from")} {filters.startDate}<button onClick={() => updateFilter("startDate", "")}>×</button></span>}
          {filters.endDate && <span className="filter-chip">{t("common.to")} {filters.endDate}<button onClick={() => updateFilter("endDate", "")}>×</button></span>}
          <button type="button" className="filter-chip clear-all-chip" onClick={clearAllFilters}>{t("filter.clear")} ×</button>
        </div>
      )}
    </>
  );
}
