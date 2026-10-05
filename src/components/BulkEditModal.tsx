"use client";

/**
 * Bulk edit for the ticked table rows.
 *
 * Bulk status already exists (bulkSetStatus); this extends the same
 * `{ ids, ...fields }` PATCH to channel / location / contacts / follow-up.
 * Only fields the user touches are sent — empty means "leave alone", and
 * the apply button stays disabled until at least one field is set.
 */
import { useState } from "react";
import { X as XIcon } from "lucide-react";
import Select from "@/components/Select";
import type { TFn } from "@/lib/client-types";

export type BulkEditPatch = {
  status?: string;
  acquisitionChannel?: string;
  location?: string;
  firstContactPerson?: string;
  secondContactPerson?: string;
  nextFollowUpAt?: string | null;
};

export default function BulkEditModal({
  count,
  allStatuses,
  allChannels,
  allLocations,
  users,
  onClose,
  onApply,
  t,
}: {
  count: number;
  allStatuses: string[];
  allChannels: string[];
  allLocations: string[];
  users: { name: string }[];
  onClose: () => void;
  onApply: (patch: BulkEditPatch) => void | Promise<void>;
  t: TFn;
}) {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [location, setLocation] = useState("");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [followDays, setFollowDays] = useState("");
  const [busy, setBusy] = useState(false);
  const names = users.map((u) => u.name);
  const dirty = Boolean(status || channel || location || first || second || followDays.trim());

  const apply = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const patch: BulkEditPatch = {};
      if (status) patch.status = status;
      if (channel) patch.acquisitionChannel = channel;
      if (location) patch.location = location;
      if (first) patch.firstContactPerson = first;
      if (second) patch.secondContactPerson = second;
      const days = Number(followDays);
      if (followDays.trim() && Number.isFinite(days) && days >= 0) {
        patch.nextFollowUpAt = new Date(Date.now() + days * 86400000).toISOString();
      }
      await onApply(patch);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("bulkEdit.title", { n: count })}</h2>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            <XIcon size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <label className="field">
              <span>{t("bulkEdit.status")}</span>
              <Select value={status} options={["", ...allStatuses]} onChange={setStatus} render={(v) => (v === "" ? t("common.all") : v)} t={t} />
            </label>
            <label className="field">
              <span>{t("bulkEdit.channel")}</span>
              <Select value={channel} options={["", ...allChannels]} onChange={setChannel} render={(v) => (v === "" ? t("common.all") : v)} t={t} />
            </label>
            <label className="field">
              <span>{t("bulkEdit.location")}</span>
              <Select value={location} options={["", ...allLocations]} onChange={setLocation} render={(v) => (v === "" ? t("common.all") : v)} t={t} />
            </label>
            <label className="field">
              <span>{t("bulkEdit.firstContact")}</span>
              <Select value={first} options={["", ...names]} onChange={setFirst} render={(v) => (v === "" ? t("form.unassigned") : v)} t={t} />
            </label>
            <label className="field">
              <span>{t("bulkEdit.secondContact")}</span>
              <Select value={second} options={["", ...names]} onChange={setSecond} render={(v) => (v === "" ? t("form.unassigned") : v)} t={t} />
            </label>
            <label className="field">
              <span>{t("bulkEdit.followUpInDays")}</span>
              <input
                type="number"
                min={0}
                value={followDays}
                onChange={(e) => setFollowDays(e.target.value)}
                placeholder="3"
              />
            </label>
          </div>
          {!dirty && <p className="muted">{t("bulkEdit.noChange")}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn-primary" disabled={!dirty || busy} onClick={() => void apply()}>
            {t("bulkEdit.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
