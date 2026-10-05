"use client";

/**
 * Global client search (Ctrl+K / Cmd+K).
 *
 * The clients table already has a search box, but only once you are ON the
 * clients screen. Answering "which client was that, the one who called about the
 * Riyadh villa?" meant navigating to the table first, then hoping the filter bar
 * was still set to something sensible.
 *
 * Keyboard-first and deliberately small: arrow keys to move, Enter to open,
 * Escape to dismiss. Arrow/Enter/Escape are handled in the INPUT's onKeyDown
 * rather than with a global keydown listener, so they only apply while the palette
 * actually has focus and can never swallow a key the page underneath needed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserRound, X as XIcon } from "lucide-react";
import StatusPill from "@/components/StatusPill";
import type { TFn } from "@/lib/client-types";

type Hit = {
  id: string;
  name: string;
  phoneNumber: string;
  status: string;
  project: string;
  location: string;
  firstContactPerson: string;
};

export default function CommandPalette({ t }: { t: TFn }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K / Cmd+K from anywhere, including from inside a text field: a user
  // looking for a different client should not have to click away first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Focus the field as soon as it opens, so typing goes straight in.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits(null);
    setActive(0);
  }, []);

  /* Debounced fetch.
     `live` guards the state write so a slow response for "ah" cannot land after a
     fast one for "ahmad" and replace the newer results with older ones, which is
     the classic out-of-order race that makes a typeahead feel broken. */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      setTotal(0);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { results: [], total: 0 }))
        .then((d: { results?: Hit[]; total?: number }) => {
          if (!live) return;
          setHits(d.results ?? []);
          setTotal(d.total ?? 0);
          setActive(0);
        })
        .catch(() => {
          // Leave the previous list rather than blanking it: a dropped request
          // should not read as "no such client".
          if (live) setHits([]);
        });
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const go = (id: string) => {
    close();
    router.push(`/clients/${id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (!hits || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) go(hit.id);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="topbar-search"
        onClick={() => setOpen(true)}
        title={t("search.title")}
      >
        <Search size={15} />
        <span>{t("search.placeholder")}</span>
        <kbd>Ctrl K</kbd>
      </button>
    );
  }
return (
    <div className="modal-overlay search-overlay" onClick={close}>
      <div
        className="search-palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("search.title")}
      >
        <div className="search-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
          />
          <button className="icon-btn-sm" onClick={close} aria-label={t("common.close")}>
            <XIcon size={15} />
          </button>
        </div>

        <div className="search-results">
          {query.trim().length < 2 && <div className="empty-state">{t("search.hint")}</div>}
          {query.trim().length >= 2 && hits === null && (
            <div className="empty-state">{t("common.loading")}</div>
          )}
          {hits !== null && hits.length === 0 && (
            <div className="empty-state">{t("search.noResults", { q: query.trim() })}</div>
          )}
          {/* Only shown when the list really is partial. `total` is the server
              COUNT, so this cannot claim a truncation that did not happen. */}
          {hits !== null && hits.length > 0 && total > hits.length && (
            <div className="search-note">{t("search.more", { n: total, shown: hits.length })}</div>
          )}
          {hits?.map((hit, i) => (
            <button
              key={hit.id}
              type="button"
              className={`search-hit ${i === active ? "search-hit-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit.id)}
            >
              <UserRound size={15} />
              <span className="search-hit-main">
                <b>{hit.name}</b>
                <span className="search-hit-sub">
                  <span className="ltr-num">{hit.phoneNumber}</span>
                  {hit.project && <> &middot; {hit.project}</>}
                  {hit.location && <> &middot; {hit.location}</>}
                  {hit.firstContactPerson && <> &middot; {hit.firstContactPerson}</>}
                </span>
              </span>
              <StatusPill status={hit.status} t={t} variant="badge" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}