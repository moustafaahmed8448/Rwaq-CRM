"use client";

/**
 * The campaign add/edit form, shared by /marketing and /metrics.
 *
 * Verbatim what /marketing rendered on its own, lifted out so both pages edit
 * campaigns through the same markup, the same `Field` wrapper and the same error
 * line. The modal owns no state of its own — everything comes from the editor
 * hook, which is what makes the two pages behave identically rather than merely
 * look identical.
 */
import { Save, X } from "lucide-react";
import Field from "@/components/Field";
import RefPicker from "@/components/RefPicker";
import { channelLabel } from "@/lib/reporting";
import type { MetricEditor } from "@/lib/use-metric-editor";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export default function MetricFormModal({
  editor,
  t,
  allChannels,
  canEdit,
}: {
  editor: MetricEditor;
  t: TFn;
  /** Built-in channels plus any saved ones. */
  allChannels: string[];
  /** Admins only: gates the channel picker's delete affordance. */
  canEdit: boolean;
}) {
  const {
    showForm,
    isEdit,
    form,
    setForm,
    formErrors,
    saveError,
    removableChannels,
    channelUsage,
    closeForm,
    clearError,
    handleSubmit,
    addChannel,
    removeChannel,
  } = editor;

  if (!showForm) return null;

  return (
    <div className="modal-overlay" onClick={closeForm}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? t("mkt.editMetric") : t("mkt.addMetric")}</h2>
          <button className="modal-close" onClick={closeForm}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <Field label={t("mkt.campaignName")} wide>
              <input
                placeholder={t("mkt.campaignNamePh")}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label={t("form.channel")} error={formErrors.channel}>
              <RefPicker
                kind="channels"
                value={form.channel === "__custom__" ? form.customChannelName || "" : form.channel}
                options={allChannels}
                onChange={(v) => {
                  clearError("channel");
                  setForm((f) => ({ ...f, channel: v, customChannelName: "" }));
                }}
                render={(v) => channelLabel(t, v)}
                placeholder={t("form.channelPh")}
                onAdd={addChannel}
                onRemove={canEdit ? removeChannel : undefined}
                removable={removableChannels}
                removeUsage={channelUsage}
                t={t}
              />
            </Field>
            <Field label={t("mkt.startDate")} error={formErrors.startDate}>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => {
                  clearError("startDate");
                  setForm((f) => ({ ...f, startDate: e.target.value }));
                }}
              />
            </Field>
            <Field label={t("mkt.endDate")} error={formErrors.endDate}>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => {
                  clearError("endDate");
                  setForm((f) => ({ ...f, endDate: e.target.value }));
                }}
              />
            </Field>
            <Field label={t("mkt.spend")} error={formErrors.spend}>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.spend}
                onChange={(e) => {
                  clearError("spend");
                  setForm((f) => ({ ...f, spend: e.target.value }));
                }}
              />
            </Field>
            <Field label={t("mkt.reach")}>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={form.reach}
                onChange={(e) => setForm((f) => ({ ...f, reach: e.target.value }))}
              />
            </Field>
            <Field label={t("mkt.clicks")}>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={form.clicks}
                onChange={(e) => setForm((f) => ({ ...f, clicks: e.target.value }))}
              />
            </Field>
            <Field label={t("mkt.impressions")}>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={form.impressions}
                onChange={(e) => setForm((f) => ({ ...f, impressions: e.target.value }))}
              />
            </Field>
            <Field label={t("mkt.notes")} wide>
              <textarea
                rows={2}
                placeholder={t("mkt.notesPh")}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
          </div>
          {saveError && (
            <div className="form-errors" style={{ marginTop: 12 }} role="alert">
              <div>{saveError}</div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={closeForm}>
            {t("common.cancel")}
          </button>
          <button className="btn-primary" onClick={() => void handleSubmit()}>
            <Save size={15} />
            {isEdit ? t("common.saveChanges") : t("mkt.addMetric")}
          </button>
        </div>
      </div>
    </div>
  );
}