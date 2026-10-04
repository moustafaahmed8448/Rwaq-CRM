"use client";

/**
 * The users page: the team directory as a filterable, resizable table, with the
 * add / edit / delete that used to live only inside /settings.
 *
 * /settings keeps its Team Members section — nothing was moved out of it. This
 * is the same data given a real table: a search box, a role filter, paging, and
 * column widths that persist under their own `userColumns` blob.
 *
 * Admin-only, mirroring the section it grew out of. The page itself checks the
 * role so a rep who types the URL gets an explanation rather than an empty
 * table; the real boundary is /api/users, which rejects every write from a
 * non-admin regardless of what the UI offers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, X as XIcon, Check, Camera } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import UserTable, { type ManagedUser } from "@/components/UserTable";
import UserDetailPanel from "@/components/UserDetailPanel";
import MultiSelect from "@/components/MultiSelect";
import Select from "@/components/Select";
import { useLang } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/api-errors";
import { roleLabel } from "@/lib/reporting";
import { readAvatarFile, initialsOf } from "@/lib/avatar";
import { USER_COLUMNS, type ColumnPrefs } from "@/lib/user-columns";
import { useColumnLayout } from "@/lib/use-column-layout";
import type { TFn } from "@/lib/client-types";

/** Assignable roles, the same list the settings add-user form offers. */
const ROLES = ["Admin", "Sales", "CRM", "Visitor"];

type SessionUser = { name: string; initials: string; role: string; userColumns?: ColumnPrefs };

const PAGE_SIZE = 25;

const EMPTY_FORM = { name: "", username: "", email: "", password: "", role: "Sales", phone: "", jobTitle: "", notes: "", avatar: "" };

export default function UsersPage() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ManagedUser | null>(null);
  /* The open panel is stored as a USERNAME, not a member object. The panel then
     derives from `users`, so a save or a delete in the form updates it for free —
     holding the object would leave the panel showing the pre-save values until it
     was reopened. */
  const [detailUsername, setDetailUsername] = useState<string | null>(null);
  const detail = useMemo(
    () => (detailUsername ? users.find(u => u.username === detailUsername) ?? null : null),
    [users, detailUsername],
  );

  const { columns, commit: setColumns, hydrate } = useColumnLayout(USER_COLUMNS, "userColumns");
  const rtl = lang === "ar";

  const loadUsers = useCallback(async () => {
    const r = await fetch("/api/users").catch(() => null);
    if (!r || !r.ok) return;
    const d = await r.json() as { users?: ManagedUser[] };
    setUsers(d.users ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) { router.replace("/login"); return; }
      const d = await r.json() as { authenticated: boolean; user?: SessionUser };
      if (!d.authenticated) { router.replace("/login"); return; }
      setUser(d.user ?? null);
      // Adopt this user's saved users-table widths, if any.
      hydrate(d.user?.userColumns ?? null);
      await loadUsers();
    }).catch(() => {});
    const stored = localStorage.getItem("rwaq-dark");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "1") setDarkMode(true);
  }, [router, hydrate, loadUsers]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  /* Filtered on the CLIENT rather than the server: /api/users returns the whole
     team (tens of rows, not thousands), so a request per keystroke would cost
     more than the filter itself. Search and role AND together. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(u => {
      if (roleFilter.length > 0 && !roleFilter.includes(u.role)) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, query, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // A filter change can leave the user on a page that no longer exists; clamping
  // here avoids rendering an empty table above a pager that says "page 4 of 2".
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilters = query.trim() !== "" || roleFilter.length > 0;


  const save = async () => {
    setSaving(true);
    setFormErr("");
    try {
      const res = editing
        ? await fetch("/api/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: editing.username,
            newUsername: form.username,
            name: form.name,
            email: form.email,
            role: form.role,
            // Empty string means "clear it" — readOptional in the route turns a
            // blank into null, so blanking the notes actually unsets the column
            // rather than storing "".
            phone: form.phone,
            jobTitle: form.jobTitle,
            notes: form.notes,
            avatar: form.avatar,
          }),
        })
        : await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      const d = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(t, d.error));
      closeForm();
      await loadUsers();
    } catch (e: unknown) {
      setFormErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: target.username }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const d = await res?.json().catch(() => ({})) as { error?: string } | undefined;
      setFormErr(apiErrorMessage(t, d?.error));
      return;
    }
    await loadUsers();
  };

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErr("");
    setShowForm(true);
  };

  const openEdit = (u: ManagedUser) => {
    setEditing(u);
    // `?? ""` on every optional: the form's inputs are controlled, so a null from
    // the API has to become an empty string or React warns about switching an
    // uncontrolled input to controlled.
    setForm({
      name: u.name,
      username: u.username,
      email: u.email ?? "",
      password: "",
      role: u.role,
      phone: u.phone ?? "",
      jobTitle: u.jobTitle ?? "",
      notes: u.notes ?? "",
      avatar: u.avatar ?? "",
    });
    setFormErr("");
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setFormErr(""); };

  /** Reads a picked photo, downscales it, and holds the data URL in the form. */
  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset first, so choosing the SAME file twice still fires onChange.
    e.target.value = "";
    if (!file) return;
    setFormErr("");
    try {
      const dataUrl = await readAvatarFile(file);
      setForm(f => ({ ...f, avatar: dataUrl }));
    } catch (err) {
      setFormErr(err instanceof Error && err.message === "TOO_LARGE"
        ? t("settings.errAvatarTooBig")
        : t("users.photoInvalid"));
    }
  };

  /* Nothing renders until the session resolves — the nav, the page title and the
     admin-only gate all read `user`. Placed here rather than mid-function so the
     handlers above stay defined and reachable from the JSX below. */
  if (!user) {
    return <main className="shell-loading"><div className="spinner" /></main>;
  }

  return (
    <>
      <AppHeader user={user} active="users" darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
      <main className="content">
        {/* `.page-header`, not `page-head`: only the former exists in globals.css
            (185-187), so `page-head` rendered this title row completely unstyled. */}
        <div className="page-header">
          <div>
            <h1>{t("users.title")}</h1>
            <p className="muted">{t("users.subtitle")}</p>
          </div>
          {user.role === "Admin" && (
            <button className="btn-primary" onClick={openAdd}><Plus size={15} />{t("settings.addUser")}</button>
          )}
        </div>

        {user.role !== "Admin" ? (
          <section className="panel"><p className="muted">{t("users.adminOnly")}</p></section>
        ) : (
          <>
            {/* Filters. Same primitives as the clients page so the two read
                identically: a search box, a multi-select, and a clear button
                that only appears once something is actually applied. */}
            <section className="filter-row">
              <div className="search-box">
                <Search size={15} />
                <input
                  placeholder={t("users.searchPh")}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setPage(1); }}
                />
              </div>
              <MultiSelect
                label={t("users.allRoles")}
                options={ROLES}
                selected={roleFilter}
                onChange={v => { setRoleFilter(v); setPage(1); }}
                render={v => roleLabel(t, v)}
                t={t}
              />
              {hasFilters && (
                <button className="btn-ghost" onClick={() => { setQuery(""); setRoleFilter([]); setPage(1); }}>
                  {t("filter.clear")}
                </button>
              )}
            </section>

            <section className="panel">
              <div className="panel-heading">
                <h3>{t("users.title")} <small>{t("users.count", { n: filtered.length })}</small></h3>
              </div>
              <UserTable
                users={paged}
                columns={columns}
                onColumnsChange={setColumns}
                rtl={rtl}
                t={t as TFn}
                onEdit={openEdit}
                onDelete={setConfirmDelete}
                onOpenDetail={u => setDetailUsername(u.username)}
                /* The profile ICON goes to that person's profile page — the same
                   surface the sidebar button opens, with `?user=` scoping it to
                   one rep. `/profile` resolves the name against /api/users, so it
                   has to be the display name, not the username. Row-click keeps
                   opening the side panel. */
                onOpenProfile={u => router.push(`/profile?user=${encodeURIComponent(u.name)}`)}
              />
              {totalPages > 1 && (
                <div className="pager">
                  <button className="btn-outline btn-sm" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{t("pager.prev")}</button>
                  <span className="muted">{t("pager.pageOf", { page: safePage, count: totalPages })}</span>
                  <button className="btn-outline btn-sm" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>{t("pager.next")}</button>
                </div>
              )}
            </section>
          </>
        )}
      </main>


      {/* Profile side panel. Closes the panel before opening a form or the delete
          confirm, so the two overlays never stack. */}
      {detail && (
        <UserDetailPanel
          user={detail}
          onClose={() => setDetailUsername(null)}
          onOpenProfile={() => {
            // Hand the name over as a query param rather than a path segment: these
            // names carry spaces and Arabic, and /profile matches on them.
            setDetailUsername(null);
            router.push(`/profile?user=${encodeURIComponent(detail.name)}`);
          }}
          onEdit={() => { setDetailUsername(null); openEdit(detail); }}
          onDelete={() => { setDetailUsername(null); setConfirmDelete(detail); }}
          t={t as TFn}
          lang={lang}
        />
      )}

      {/* ── Add / Edit modal ──
          Uses the shared `.modal` chrome, which is capped to the viewport and
          scrolls its body — the same card the client form uses. */}
      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? t("settings.editUser") : t("settings.addUser")}</h2>
              <button className="modal-close" onClick={closeForm} aria-label={t("common.close")}><XIcon size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <Field label={t("settings.field.fullName")}>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t("settings.fullNamePh")} />
                </Field>
                <Field label={t("settings.field.username")}>
                  <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase() }))} placeholder={t("settings.usernamePh")} />
                </Field>
                <Field label={t("settings.field.email")}>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder={t("settings.emailPh")} />
                </Field>
                {/* Password is create-only: editing a user leaves the hash alone
                    rather than needing the current password to replace it. */}
                {!editing && (
                  <Field label={t("settings.field.password")}>
                    <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={t("settings.passwordMinPh")} />
                  </Field>
                )}
                <Field label={t("settings.field.role")}>
                  <Select value={form.role} options={ROLES} onChange={v => setForm(f => ({ ...f, role: v }))} render={v => roleLabel(t, v)} searchable={false} t={t} />
                </Field>
                <Field label={t("users.phone")}>
                  <input dir="ltr" className="ltr-num" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </Field>
                <Field label={t("users.jobTitle")}>
                  <input value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} />
                </Field>
                {/* Photo. `wide` so it spans the form: at half width the picker had
                    to sit next to the avatar, which squeezed the button until its
                    label wrapped onto a second line under the icon. `.no-detail` so
                    the row-click guard in the table ignores it. */}
                <Field label={t("users.photo")} wide>
                  <div className="avatar-upload no-detail">
                    <span className="user-avatar-lg">
                      {form.avatar ? <img src={form.avatar} alt="" /> : initialsOf(form.name || "?")}
                    </span>
                    <div className="avatar-upload-actions">
                      <label className="btn-outline avatar-upload-btn">
                        <Camera size={13} />{t("users.changePhoto")}
                        <input type="file" accept="image/*" onChange={pickAvatar} hidden />
                      </label>
                      {form.avatar && (
                        <button type="button" className="btn-text-danger" onClick={() => setForm(f => ({ ...f, avatar: "" }))}>
                          <XIcon size={13} />{t("users.removePhoto")}
                        </button>
                      )}
                    </div>
                  </div>
                </Field>
                <Field label={t("users.notes")} wide>
                  <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </Field>
              </div>
              {formErr && <div className="settings-error" style={{ marginTop: 8 }}>{formErr}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={closeForm}>{t("common.cancel")}</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                <Check size={15} />{saving ? t("settings.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ── */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t("settings.deleteUserTitle")}</h2>
              <button className="modal-close" onClick={() => setConfirmDelete(null)} aria-label={t("common.close")}><XIcon size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="delete-warning">
                <Trash2 size={24} />
                <div>
                  <strong>{confirmDelete.name}</strong>
                  <p>@{confirmDelete.username}</p>
                </div>
              </div>
              {formErr && <div className="settings-error" style={{ marginTop: 8 }}>{formErr}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</button>
              <button className="btn-danger" onClick={remove}><Trash2 size={15} />{t("common.delete")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  // `wide` spans both columns of the form grid, for the fields that need the room
  // (the photo picker, the notes box).
  return (
    <div className="form-field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span className="form-label">{label}</span>{children}
    </div>
  );
}

