"use client";

/**
 * Add / edit / delete for a marketing campaign row — the whole editor, shared.
 *
 * This lived entirely inside src/app/marketing/page.tsx, which is why /metrics
 * could list the very same campaigns and offer no way to change one: it renders
 * the SAME `MARKETING_COLUMNS` registry, so its locked `actions` column was
 * already in the grid, just empty (that is the blank trailing column at the right
 * edge of the table). Copying the ~150 lines into a second page would have left
 * two validations, two error paths and two channel pickers to keep in step, so it
 * is pulled out here and both pages drive this one hook.
 *
 * The page supplies only a `reload` callback and, optionally, a way to learn that
 * the saved channel list changed; everything else — form state, validation, the
 * request, and the error text — is identical on both pages by construction.
 */
import { useState } from "react";
import { apiErrorMessage } from "@/lib/api-errors";
import type { MarketingMetric } from "@/lib/types";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export interface MetricForm {
  name: string;
  channel: string;
  startDate: string;
  endDate: string;
  spend: string;
  reach: string;
  impressions: string;
  clicks: string;
  notes: string;
  customChannelName: string;
}

const EMPTY_FORM: MetricForm = {
  name: "",
  channel: "FACEBOOK",
  startDate: "",
  endDate: "",
  spend: "",
  reach: "",
  impressions: "",
  clicks: "",
  notes: "",
  customChannelName: "",
};

export interface MetricEditor {
  /** Render the modal only when this is true. */
  showForm: boolean;
  /** True while editing an existing row rather than adding one. */
  isEdit: boolean;
  form: MetricForm;
  setForm: React.Dispatch<React.SetStateAction<MetricForm>>;
  formErrors: Record<string, string>;
  saveError: string;
  /** Channels an admin may delete: saved-only, and still unused. */
  removableChannels: string[];
  /** Rows per channel, so the picker's trash icon only appears at zero. */
  channelUsage: Record<string, number>;
  openAdd: () => void;
  openEdit: (m: MarketingMetric) => void;
  closeForm: () => void;
  clearError: (key: string) => void;
  handleSubmit: () => Promise<void>;
  deleteMetric: (id: string) => Promise<void>;
  addChannel: (label: string) => Promise<string>;
  removeChannel: (label: string) => Promise<void>;
}

export function useMetricEditor({
  t,
  reload,
  onChannelsChanged,
}: {
  t: TFn;
  /** Re-reads the campaign rows; called after every successful write. */
  reload: () => Promise<void>;
  /** Told when the saved channel list changes, so the host's picker updates. */
  onChannelsChanged?: (data: { channels: string[]; removable: string[]; usage: Record<string, number> }) => void;
}): MetricEditor {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MetricForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // A failed save used to be completely silent on this form: `if (res.ok)` had no
  // else branch, so a 500 / 409 / 403 looked identical to clicking nothing.
  const [saveError, setSaveError] = useState("");
  const [removableChannels, setRemovableChannels] = useState<string[]>([]);
  const [channelUsage, setChannelUsage] = useState<Record<string, number>>({});

  /**
   * Re-reads the saved channel list. Kept here rather than passed in because the
   * modal's trash icon depends on it, and a host without the marketing page's
   * channel state would otherwise silently lose that guard.
   */
  const readChannels = async () => {
    const r = await fetch("/api/channels")
      .then((x) => x.json() as { channels?: string[]; removable?: string[]; usage?: Record<string, number> })
      .catch((): { channels?: string[]; removable?: string[]; usage?: Record<string, number> } => ({}));
    const data = { channels: r.channels ?? [], removable: r.removable ?? [], usage: r.usage ?? {} };
    setRemovableChannels(data.removable);
    setChannelUsage(data.usage);
    return data;
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setSaveError("");
    setShowForm(true);
    void readChannels();
  };

  const openEdit = (m: MarketingMetric) => {
    setEditingId(m.id);
    setForm({
      name: m.name ?? "",
      channel: m.channel,
      startDate: m.startDate,
      endDate: m.endDate,
      spend: String(m.spend),
      reach: String(m.reach),
      impressions: String(m.impressions),
      clicks: String(m.clicks),
      notes: m.notes ?? "",
      customChannelName: "",
    });
    setFormErrors({});
    setSaveError("");
    setShowForm(true);
    void readChannels();
  };

  const closeForm = () => {
    setShowForm(false);
    setSaveError("");
    setFormErrors({});
  };

  /** Editing a field clears just that field's error. */
  const clearError = (key: string) => {
    setFormErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
    setSaveError("");
  };
/** Creates a new channel and returns its stored (upper-cased) value. */
  const addChannel = async (label: string): Promise<string> => {
    const ch = label.trim().toUpperCase().replace(/\s+/g, "_");
    if (!ch) return label;
    await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: ch }),
    }).catch(() => {});
    onChannelsChanged?.(await readChannels());
    return ch;
  };

  /**
   * Deletes a saved channel from the reference list.
   *
   * Only admins reach this (the button is not rendered otherwise), and the API
   * independently refuses to delete a built-in or a channel still used by
   * clients — the picker's own `used === 0` gate is the matching UI guard.
   */
  const removeChannel = async (label: string) => {
    const res = await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const err = res ? await res.json().catch(() => ({})) : null;
      setSaveError(apiErrorMessage(t, (err as { error?: unknown })?.error));
      return;
    }
    onChannelsChanged?.(await readChannels());
    // Drop it from the form if it was the selected channel.
    setForm((f) => (f.channel === label ? { ...f, channel: "FACEBOOK" } : f));
  };

  const handleSubmit = async () => {
    // The picker creates custom channels as you type them, so there is no
    // separate "__custom__" branch to resolve here any more.
    const channel = form.channel;
    const errors: Record<string, string> = {};
    if (!form.channel) errors.channel = t("form.required");
    if (!form.startDate) errors.startDate = t("form.required");
    if (!form.endDate) errors.endDate = t("form.required");
    if (form.startDate && form.endDate && form.startDate > form.endDate) errors.endDate = t("form.afterStart");
    if (!form.spend && form.spend !== "0") errors.spend = t("form.required");
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setSaveError(t("form.fixErrors"));
      return;
    }
    setFormErrors({});
    setSaveError("");

    const body = {
      name: form.name,
      channel,
      startDate: form.startDate,
      endDate: form.endDate,
      spend: Number(form.spend),
      reach: Number(form.reach ?? 0),
      impressions: Number(form.impressions ?? 0),
      clicks: Number(form.clicks ?? 0),
      notes: form.notes,
    };

    const res = editingId
      ? await fetch("/api/marketing/metrics", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...body }),
        })
      : await fetch("/api/marketing/metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

    if (res.ok) {
      await reload();
      setShowForm(false);
      setSaveError("");
      setForm(EMPTY_FORM);
      return;
    }

    // The failure branch that used to be missing. Without it a 500, a 409
    // "duplicate metric" and a 403 all looked like clicking nothing happened.
    let detail: unknown;
    try {
      detail = (await res.json()) as { error?: unknown };
    } catch {
      detail = undefined;
    }
    setSaveError(
      typeof (detail as { error?: unknown })?.error === "string"
        ? apiErrorMessage(t, (detail as { error: string }).error)
        : t("mkt.saveFailed"),
    );
  };

  const deleteMetric = async (id: string) => {
    if (!confirm(t("mkt.deleteConfirm"))) return;
    await fetch("/api/marketing/metrics", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await reload();
  };

  return {
    showForm,
    isEdit: Boolean(editingId),
    form,
    setForm,
    formErrors,
    saveError,
    removableChannels,
    channelUsage,
    openAdd,
    openEdit,
    closeForm,
    clearError,
    handleSubmit,
    deleteMetric,
    addChannel,
    removeChannel,
  };
}