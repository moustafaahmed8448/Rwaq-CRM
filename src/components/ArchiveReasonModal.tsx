"use client";

/**
 * Archive confirmation with an optional reason.
 *
 * No schema migration: the reason is stored as a NOTE_ADD timeline entry
 * plus (when present) appended to the archive toast, and surfaced on the
 * archived page from the client's own activity log. Restoring needs no
 * extra step — the archived page already confirms restores.
 */
import { useState } from "react";
import { Archive, X as XIcon } from "lucide-react";
import type { TFn } from "@/lib/client-types";

export default function ArchiveReasonModal({
  name,
  onClose,
  onConfirm,
  t,
}: {
  name: string;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  t: TFn;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal delete-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("archive.confirmWithReason", { name })}</h2>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            <XIcon size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field field-wide">
            <span>{t("archive.reasonLabel")}</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("archive.reasonPh")}
            />
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => void confirm()}>
            <Archive size={15} />
            {t("nav.archived")}
          </button>
        </div>
      </div>
    </div>
  );
}
