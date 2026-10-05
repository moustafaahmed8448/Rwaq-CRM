"use client";
import { useEffect, useState } from "react";
import { UserRound, Mail, Key, Save, Trash2, LogOut, Eye, EyeOff, Camera, X, Plus, Users, Check, Settings, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/api-errors";
import { readLogoFile, useLogo } from "@/lib/logo";
import { initialsOf, readAvatarFile } from "@/lib/avatar";
import { roleLabel } from "@/lib/reporting";
import AppHeader from "@/components/AppHeader";
import Select from "@/components/Select";

/** Assignable roles, shared by the add-user and edit-user forms. */
const ROLES = ["Admin", "Sales", "CRM", "Visitor"];

/**
 * The four groups the settings page is split into.
 *
 * It used to be one 640px column of six stacked sections, so reaching "Change
 * password" meant scrolling past the profile photo, the language switch and the
 * whole team list. Grouping by intent is what the reader is actually doing.
 *
 * `adminOnly` hides Team for non-admins. The Team tab is still skipped rather
 * than rendered-empty, so a rep opening Settings never lands on a blank page.
 */
type SettingsTab = "profile" | "security" | "team" | "appearance";

const SETTINGS_TABS: { key: SettingsTab; labelKey: string; adminOnly?: boolean }[] = [
  { key: "profile", labelKey: "settings.tabProfile" },
  { key: "security", labelKey: "settings.tabSecurity" },
  { key: "team", labelKey: "settings.tabTeam", adminOnly: true },
  { key: "appearance", labelKey: "settings.tabAppearance" },
];

type User = { name: string; initials: string; role: string; email?: string; avatar?: string; username?: string };
/* `avatar` was missing here, so this list drew initials for everyone — including
   people whose photo /users and the header were already showing. /api/users has
   always returned it; the local type was the only thing dropping it. */
type ManagedUser = { username: string; name: string; email?: string; role: string; avatar?: string | null };

export default function SettingsPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLang();
  const [user, setUser] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [tab, setTab] = useState<SettingsTab>("profile");
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", username: "", email: "", password: "", role: "Sales" as string });
  const [userErr, setUserErr] = useState("");
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", username: "", email: "", role: "Sales" });
  const [savingUser, setSavingUser] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  // `logo` is the shared source of truth; the header and login read the same
  // Setting row, and setLogo() keeps their local caches in step.
  const { logo: logoUrl, setLogo } = useLogo();
  const [logoErr, setLogoErr] = useState("");
  const [savingLogo, setSavingLogo] = useState(false);

  const loadUsers = async () => {
    const r = await fetch("/api/users");
    if (r.ok) { const d = await r.json() as { users?: ManagedUser[] }; setManagedUsers(d.users ?? []); }
  };

  useEffect(() => {
    fetch("/api/auth/me").then(async r => {
      if (!r.ok) { router.replace("/login"); return; }
      const d = await r.json() as { authenticated: boolean; user?: User };
      if (!d.authenticated) { router.replace("/login"); return; }
      setUser(d.user ?? null);
      setEditName(d.user?.name ?? "");
      setEditEmail(d.user?.email ?? "");
      // The session is the source of truth for the photo now. localStorage was
      // consulted before because /api/auth/me did not carry an avatar at all, so
      // the picture lived in this browser only and vanished on another machine —
      // and the account's own row on /users showed a photo the settings page had
      // never heard of. Kept as a fallback for photos saved before this change.
      const fromDb = typeof d.user?.avatar === "string" ? d.user.avatar : "";
      const stored = fromDb || localStorage.getItem("rwaq-avatar") || "";
      if (stored) setAvatarUrl(stored);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("rwaq-dark") === "1") setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("rwaq-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      // Downscale in the browser, then store it on the ACCOUNT.
      //
      // This used to end at localStorage: it set the value, poked the header and
      // moved on. Nothing was ever sent to the server, so the photo existed only
      // in this one browser — /profile and the users table had nothing to read,
      // which is why they fell back to initials. One photo per person now lives
      // on the user row, like every other field, and follows you to another
      // machine or browser.
      const dataUrl = await readAvatarFile(file);
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: dataUrl }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: unknown };
        setError(apiErrorMessage(t, body.error));
        return;
      }
      // Trust the server's copy rather than what we sent: it echoes what it
      // actually stored, which is the value every other screen will read.
      const { avatar } = await res.json().catch(() => ({ avatar: "" })) as { avatar?: string | null };
      const stored = avatar ?? "";
      setAvatarUrl(stored);
      // Only a cache now, for chrome that has not re-fetched yet.
      if (stored) localStorage.setItem("rwaq-avatar", stored);
      else localStorage.removeItem("rwaq-avatar");
      setUser(u => u ? { ...u, avatar: stored } : null);
      // Tell the header (and any other mounted chrome) to re-read it.
      window.dispatchEvent(new Event("rwaq-avatar-changed"));
    } catch (err) {
      setError(err instanceof Error && err.message === "TOO_LARGE"
        ? t("settings.errAvatarTooBig")
        : t("users.photoInvalid"));
    } finally {
    }
  };

  const removeAvatar = async () => {
    setError("");
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // "" is the EXPLICIT clear. Leaving the key out is read as "leave this
        // field alone", which is the whole difference between this button working
        // and silently doing nothing.
        body: JSON.stringify({ avatar: "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: unknown };
        setError(apiErrorMessage(t, body.error));
        return;
      }
      setAvatarUrl("");
      localStorage.removeItem("rwaq-avatar");
      setUser(u => u ? { ...u, avatar: "" } : null);
      window.dispatchEvent(new Event("rwaq-avatar-changed"));
    } finally {
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = "";
    if (!file) return;
    setLogoErr("");
    setSavingLogo(true);
    try {
      // Downscale in the browser so the stored row stays small — every user
      // downloads it on every page load.
      const dataUrl = await readLogoFile(file);
      const res = await fetch("/api/settings/logo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logo: dataUrl }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: unknown };
        setLogoErr(apiErrorMessage(t, body.error));
        return;
      }
      setLogo(dataUrl);
    } catch (err) {
      setLogoErr(err instanceof Error && err.message === "TOO_LARGE"
        ? t("settings.logoTooBig")
        : t("errors.logoInvalid"));
    } finally {
      setSavingLogo(false);
    }
  };

  const removeLogo = async () => {
    setLogoErr("");
    setSavingLogo(true);
    try {
      const res = await fetch("/api/settings/logo", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: unknown };
        setLogoErr(apiErrorMessage(t, body.error));
        return;
      }
      setLogo("");
    } finally {
      setSavingLogo(false);
    }
  };

  const saveProfile = async () => {
    setError(""); setSaveMsg("");
    try {
      const res = await fetch("/api/auth/update-profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, email: editEmail }),
      });
      const d = await res.json() as { error?: string; user?: { name: string; email?: string } };
      if (!res.ok) throw new Error(apiErrorMessage(t, d.error));
      /* Re-render from the values the SERVER stored, not the ones typed into the
         form. The two used to come from the same optimistic local state, so a
         request the server quietly declined still produced the green
         "Profile saved successfully" banner with the unsaved text left on
         screen. A missing `user` is treated as a failure for the same reason. */
      if (!d.user) throw new Error(t("errors.generic"));
      setUser(u => u ? { ...u, name: d.user!.name, email: d.user!.email } : null);
      setEditName(d.user.name);
      if (d.user.email !== undefined) setEditEmail(d.user.email);
      setSaveMsg(t("settings.profileSaved"));
    } catch (e: unknown) { setError((e as Error).message); }
  };

  const changePassword = async () => {
    setError(""); setSaveMsg("");
    if (newPassword.length < 6) { setError(t("settings.errPasswordMin")); return; }
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(t, d.error));
      setCurrentPassword(""); setNewPassword("");
      setSaveMsg(t("settings.passwordChanged"));
    } catch (e: unknown) { setError((e as Error).message); }
  };

  const addUser = async () => {
    setUserErr("");
    if (!newUser.name || !newUser.username || !newUser.password) { setUserErr(t("settings.errUserRequired")); return; }
    if (newUser.password.length < 6) { setUserErr(t("settings.errPasswordMinShort")); return; }
    try {
      const res = await fetch("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(t, d.error));
      setNewUser({ name: "", username: "", email: "", password: "", role: "Sales" });
      setShowAddUser(false);
      await loadUsers();
    } catch (e: unknown) { setUserErr((e as Error).message); }
  };

  const deleteUser = async (username: string) => {
    if (!confirm(t("settings.deleteUserConfirm", { name: username }))) return;
    await fetch("/api/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    await loadUsers();
  };

  const startEditUser = (u: ManagedUser) => {
    setEditingUsername(u.username);
    setEditForm({ name: u.name, username: u.username, email: u.email ?? "", role: u.role });
    setUserErr("");
  };

  const saveUserEdit = async () => {
    if (!editingUsername) return;
    setSavingUser(true);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: editingUsername,
          name: editForm.name,
          newUsername: editForm.username,
          email: editForm.email,
          role: editForm.role,
        }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(t, d.error));
      setEditingUsername(null);
      setSaveMsg(t("settings.userUpdated"));
      await loadUsers();
    } catch (e: unknown) { setUserErr((e as Error).message); }
    finally { setSavingUser(false); }
  };

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); };

  if (!user) return <div className="shell-loading"><div className="spinner"/><p>{t("common.loading")}</p></div>;

  return (
    <main className="shell">
      <AppHeader user={user} active="settings" darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />

      <div className="content">
        <div className="page-header">
          <div>
            <div className="breadcrumb"><Settings size={14} />{t("settings.title")}</div>
            <h1>{t("settings.title")}</h1>
            <p>{t("settings.subtitle")}</p>
          </div>
          <div className="header-actions">
            <span className={`role-badge ${user.role.toLowerCase()}`}>{roleLabel(t, user.role)}</span>
          </div>
        </div>

        <div className="settings-container">
        {/* Tab strip. Reuses the `.imp-tabs` treatment already used by the import
            modal rather than inventing a second tab look for the app. */}
        <div className="imp-tabs settings-tabs" role="tablist">
          {SETTINGS_TABS.filter(x => !x.adminOnly || user.role === "Admin").map(x => (
            <button
              key={x.key}
              role="tab"
              type="button"
              aria-selected={tab === x.key}
              className={`imp-tab ${tab === x.key ? "active" : ""}`}
              onClick={() => setTab(x.key)}
            >
              {t(x.labelKey)}
            </button>
          ))}
        </div>

        {/* Success and error, directly under the tabs rather than at the bottom of
            a long scroll. Under tabs the old position would have been invisible
            for every panel except the last one the user happened to visit. */}
        {error && <div className="settings-error settings-banner">{error}</div>}
        {saveMsg && <div className="settings-success settings-banner">{saveMsg}</div>}

        {/* ── Profile ── */}
        {tab === "profile" && (
        <section className="settings-section">
          <div className="section-header">
            <h2>{t("settings.profile")}</h2>
            <span className="section-sub">{t("settings.profileSubtitle")}</span>
          </div>
          <div className="avatar-row">
            <div className="avatar-wrapper">
              {avatarUrl
                ? <img src={avatarUrl} alt={t("settings.avatarAlt")} className="avatar-img" />
                : <div className="avatar-default">{user.initials}</div>
              }
              <label className="avatar-photo-dot" title={t("settings.changePhoto")}>
                <Camera size={14} />
                <input type="file" accept="image/*" onChange={handleAvatarUpload} hidden />
              </label>
            </div>
            <div className="avatar-info">
              <p className="avatar-hint">{t("settings.avatarHint")}</p>
              {avatarUrl && <button className="btn-text-danger" onClick={removeAvatar}><X size={13}/>{t("settings.remove")}</button>}
              {/* No "Saving…" here on purpose. The photo appears the moment it lands,
                  so a progress line told the user nothing they could not see — and it
                  lingered for a beat after the row had already changed, which read as
                  the page being busy rather than the picture being saved. An ERROR
                  still shows below: silence on a failed upload is exactly what hid
                  the original bug, where the file was written to localStorage and
                  never sent anywhere. */}
            </div>
          </div>
          <div className="form-grid-2">
            <Field label={t("settings.field.fullName")}><input value={editName} onChange={e=>setEditName(e.target.value)} /></Field>
            <Field label={t("settings.field.email")}><input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} placeholder={user.email || t("settings.noEmail")} /></Field>
          </div>
          {/* Read-only identity. Username and role are shown rather than left to be
              discovered: they are what an admin needs when someone reports a login
              problem, and neither is editable from here by design. */}
          <div className="form-grid-2 settings-readonly">
            <Field label={t("settings.field.username")}><div className="settings-static">{user.username || "—"}</div></Field>
            <Field label={t("settings.field.role")}><div className="settings-static"><span className={`role-badge ${user.role.toLowerCase()}`}>{roleLabel(t, user.role)}</span></div></Field>
          </div>
          <button className="btn-primary" onClick={saveProfile}><Save size={15}/>{t("settings.saveProfile")}</button>
        </section>
        )}

        {/* ── Security ── */}
        {tab === "security" && (
        <section className="settings-section">
          <div className="section-header">
            <h2>{t("settings.changePassword")}</h2>
            <span className="section-sub">{t("settings.passwordSubtitle")}</span>
          </div>
          <div className="form-group">
            <label>{t("settings.field.currentPassword")}</label>
            <div className="password-input">
              <Key size={14}/>
              <input type={showPassword?"text":"password"} value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} placeholder={t("settings.currentPasswordPh")}/>
              <button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={14}/>:<Eye size={14}/>}</button>
            </div>
          </div>
          <div className="form-group">
            <label>{t("settings.field.newPassword")}</label>
            <div className="password-input">
              <Key size={14}/>
              <input type={showPassword?"text":"password"} value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder={t("auth.min6")}/>
            </div>
          </div>
          <button className="btn-outline" onClick={changePassword}>{t("settings.updatePassword")}</button>

          {/* Sign out moved here from the Danger zone. It is an account action, and
              leaving it alone at the foot of the page kept it looking like the
              destructive one next to it. */}
          <div className="danger-actions">
            <button className="btn-ghost" onClick={logout}><LogOut size={15}/>{t("settings.signOut")}</button>
          </div>
        </section>
        )}

        {/* ── Team Members (admin only) ── */}
        {tab === "team" && user.role === "Admin" && (
          <section className="settings-section">
            <div className="section-header">
              <h2><Users size={14} style={{display:"inline",verticalAlign:"middle",marginRight:6}}/>{t("settings.teamMembers")}</h2>
              <button className="btn-primary" onClick={()=>setShowAddUser(!showAddUser)} style={{fontSize:11,padding:"6px 12px"}}>
                <Plus size={13}/>{showAddUser ? t("common.cancel") : t("settings.addUser")}
              </button>
            </div>

            {showAddUser && (
              <div className="add-user-form">
                <div className="form-grid-2">
                  <Field label={t("settings.field.fullName")}><input value={newUser.name} onChange={e=>setNewUser(u=>({...u,name:e.target.value}))} placeholder={t("settings.fullNamePh")}/></Field>
                  <Field label={t("settings.field.username")}><input value={newUser.username} onChange={e=>setNewUser(u=>({...u,username:e.target.value.toLowerCase()}))} placeholder={t("settings.usernamePh")}/></Field>
                  <Field label={t("settings.field.email")}><input type="email" value={newUser.email} onChange={e=>setNewUser(u=>({...u,email:e.target.value}))} placeholder={t("settings.emailPh")}/></Field>
                  <Field label={t("settings.field.password")}><input type="password" value={newUser.password} onChange={e=>setNewUser(u=>({...u,password:e.target.value}))} placeholder={t("settings.passwordMinPh")}/></Field>
                  <Field label={t("settings.field.role")}>
                    <Select value={newUser.role} options={ROLES} onChange={v => setNewUser(u => ({ ...u, role: v }))} render={v => roleLabel(t, v)} t={t} />
                  </Field>
                </div>
                {userErr && <div className="settings-error" style={{marginTop:8}}>{userErr}</div>}
                <button className="btn-primary" onClick={addUser} style={{marginTop:10}}><Check size={14}/>{t("settings.addUser")}</button>
              </div>
            )}

            <div className="users-list">
              {managedUsers.length === 0 && <p className="muted" style={{fontSize:12,padding:"8px 0"}}>{t("settings.noTeam")}</p>}
              {managedUsers.map(u => (
                editingUsername === u.username ? (
                  <div className="edit-user-row" key={u.username}>
                    <div className="form-grid-2">
                      <Field label={t("settings.field.fullName")}><input value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))}/></Field>
                      <Field label={t("settings.field.username")}><input value={editForm.username} onChange={e=>setEditForm(f=>({...f,username:e.target.value.toLowerCase()}))}/></Field>
                      <Field label={t("settings.field.email")}><input type="email" value={editForm.email} onChange={e=>setEditForm(f=>({...f,email:e.target.value}))} placeholder={t("settings.emailPh")}/></Field>
                      <Field label={t("settings.field.role")}>
                        <Select value={editForm.role} options={ROLES} onChange={v => setEditForm(f => ({ ...f, role: v }))} render={v => roleLabel(t, v)} t={t} />
                      </Field>
                    </div>
                    {userErr && <div className="settings-error" style={{marginTop:8}}>{userErr}</div>}
                    <div style={{display:"flex",gap:8,marginTop:10}}>
                      <button className="btn-primary" onClick={saveUserEdit} disabled={savingUser}><Save size={13}/>{savingUser ? t("settings.saving") : t("common.saveChanges")}</button>
                      <button className="btn-ghost" onClick={()=>{setEditingUsername(null);setUserErr("");}}>{t("common.cancel")}</button>
                    </div>
                  </div>
                ) : (
                  <div className="user-row" key={u.username}>
                    <div className="user-row-avatar">
                      {u.avatar ? <img src={u.avatar} alt="" /> : initialsOf(u.name)}
                    </div>
                    <div className="user-row-info">
                      <strong>{u.name}</strong>
                      <small>@{u.username} · {u.email || t("settings.noEmail")}</small>
                    </div>
                    <span className={`role-badge ${u.role.toLowerCase()}`}>{roleLabel(t, u.role)}</span>
                    <button className="icon-btn-sm" onClick={()=>startEditUser(u)} title={t("settings.editUser")}><Pencil size={13}/></button>
                    <button className="icon-btn-sm danger" onClick={()=>deleteUser(u.username)} title={t("settings.deleteUserTitle")}><Trash2 size={13}/></button>
                  </div>
                )
              ))}
            </div>
          </section>
        )}

        {/* ── Appearance ──
    Language moved here from the top of the page, where it sat above the profile
    photo and pushed the thing people actually came for off the screen. */}
        {tab === "appearance" && (
          <>
            <section className="settings-section">
              <div className="section-header">
                <h2>{t("settings.preferences")}</h2>
                <span className="section-sub">{t("settings.language")}</span>
              </div>
              <div className="lang-switch" dir="ltr" role="group" aria-label={t("settings.language")}>
                <button type="button" className={lang === "ar" ? "active" : ""} aria-pressed={lang === "ar"} onClick={() => setLang("ar")}>العربية</button>
                <button type="button" className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
              </div>
            </section>
            {/* ── Dashboard logo (admin only) ── */}
            {user.role === "Admin" && (
          <section className="settings-section">
            <div className="section-header">
              <h2>{t("settings.logoSection")}</h2>
              <span className="section-sub">{t("settings.logoSubtitle")}</span>
            </div>
            <div className="logo-row">
              <div className="logo-preview">
                {logoUrl
                  ? <img src={logoUrl} alt={t("settings.logoAlt")} />
                  : <span>{t("settings.logoEmpty")}</span>
                }
              </div>
              <div className="logo-actions">
                <label className="btn-outline logo-upload-btn">
                  <Camera size={14}/>{savingLogo ? t("settings.saving") : t("settings.logoUpload")}
                  <input type="file" accept="image/*" hidden onChange={handleLogoUpload} />
                </label>
                {logoUrl && <button className="btn-text-danger" onClick={removeLogo} disabled={savingLogo}><Trash2 size={13}/>{t("settings.logoRemove")}</button>}
                <p className="muted" style={{ fontSize: 11, margin: 0 }}>{t("settings.logoHint")}</p>
                {logoErr && <div className="settings-error">{logoErr}</div>}
              </div>
            </div>
          {/* The Danger zone is gone entirely: it held only "Clear local data", which
              called `localStorage.clear()` and reloaded — one click could throw away the
              language, the dark-mode choice and the cached avatar of every open tab, and
              it sat beside Sign out looking like the destructive option. Sign out now
              lives under Security, where an account action belongs. */}
          </section>
            )}
          </>
        )}
      </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="form-field"><span className="form-label">{label}</span>{children}</div>);
}
