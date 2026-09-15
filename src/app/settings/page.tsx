"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, UserRound, Mail, Key, Save, Trash2, LogOut, Eye, EyeOff, Camera, X, Plus, Users, Check } from "lucide-react";
import { useRouter } from "next/navigation";

type User = { name: string; initials: string; role: string; email?: string; avatar?: string };
type ManagedUser = { username: string; name: string; email?: string; role: string };

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", username: "", email: "", password: "", role: "Member" as string });
  const [userErr, setUserErr] = useState("");

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
      const stored = localStorage.getItem("rwaq-avatar");
      if (stored) setAvatarUrl(stored);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
  }, [router]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Image must be under 2MB"); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const url = ev.target?.result as string;
      setAvatarUrl(url);
      setSavingAvatar(true);
      localStorage.setItem("rwaq-avatar", url);
      setUser(u => u ? { ...u, avatar: url } : null);
      setSavingAvatar(false);
    };
    reader.readAsDataURL(file);
  };

  const removeAvatar = () => {
    setAvatarUrl("");
    localStorage.removeItem("rwaq-avatar");
    setUser(u => u ? { ...u, avatar: undefined } : null);
  };

  const saveProfile = async () => {
    setError(""); setSaveMsg("");
    try {
      const res = await fetch("/api/auth/update-profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, email: editEmail }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error || "Failed to save");
      setUser(u => u ? { ...u, name: editName, email: editEmail } : null);
      setSaveMsg("Profile saved successfully");
    } catch (e: unknown) { setError((e as Error).message); }
  };

  const changePassword = async () => {
    setError(""); setSaveMsg("");
    if (newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error || "Failed");
      setCurrentPassword(""); setNewPassword("");
      setSaveMsg("Password changed successfully");
    } catch (e: unknown) { setError((e as Error).message); }
  };

  const addUser = async () => {
    setUserErr("");
    if (!newUser.name || !newUser.username || !newUser.password) { setUserErr("Name, username, and password required"); return; }
    if (newUser.password.length < 6) { setUserErr("Password min 6 chars"); return; }
    try {
      const res = await fetch("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error || "Failed");
      setNewUser({ name: "", username: "", email: "", password: "", role: "Member" });
      setShowAddUser(false);
      await loadUsers();
    } catch (e: unknown) { setUserErr((e as Error).message); }
  };

  const deleteUser = async (username: string) => {
    if (!confirm(`Delete user "${username}"?`)) return;
    await fetch("/api/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    await loadUsers();
  };

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); };

  if (!user) return <div className="shell-loading"><div className="spinner"/><p>Loading...</p></div>;

  return (
    <main className="settings-page">
      {/* ── Header ── */}
      <div className="settings-hero">
        <div className="settings-hero-inner">
          <button className="btn-ghost nav-back" onClick={() => router.back()}><ArrowLeft size={16}/>Back</button>
          <div>
            <h1>Settings</h1>
            <p>Manage your account and preferences.</p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span>
          </div>
        </div>
      </div>

      <div className="settings-container">
        {/* ── Profile ── */}
        <section className="settings-section">
          <div className="section-header">
            <h2>Profile</h2>
            <span className="section-sub">Your public information</span>
          </div>
          <div className="avatar-row">
            <div className="avatar-wrapper">
              {avatarUrl
                ? <img src={avatarUrl} alt="Avatar" className="avatar-img" />
                : <div className="avatar-default">{user.initials}</div>
              }
              <label className="avatar-upload" title="Change photo">
                <Camera size={14} />
                <input type="file" accept="image/*" onChange={handleAvatarUpload} hidden />
              </label>
            </div>
            <div className="avatar-info">
              <p className="avatar-hint">Upload a photo (max 2MB). Shown on your profile.</p>
              {avatarUrl && <button className="btn-text-danger" onClick={removeAvatar}><X size={13}/>Remove</button>}
              {savingAvatar && <span className="saving-indicator">Saving…</span>}
            </div>
          </div>
          <div className="form-grid-2">
            <Field label="Full name"><input value={editName} onChange={e=>setEditName(e.target.value)} /></Field>
            <Field label="Email"><input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} placeholder={user.email || "No email set"} /></Field>
          </div>
          <button className="btn-primary" onClick={saveProfile}><Save size={15}/>Save profile</button>
        </section>

        {/* ── Change Password ── */}
        <section className="settings-section">
          <div className="section-header">
            <h2>Change password</h2>
            <span className="section-sub">Update your login credentials</span>
          </div>
          <div className="form-group">
            <label>Current password</label>
            <div className="password-input">
              <Key size={14}/>
              <input type={showPassword?"text":"password"} value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} placeholder="Enter current password"/>
              <button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={14}/>:<Eye size={14}/>}</button>
            </div>
          </div>
          <div className="form-group">
            <label>New password</label>
            <div className="password-input">
              <Key size={14}/>
              <input type={showPassword?"text":"password"} value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="At least 6 characters"/>
            </div>
          </div>
          <button className="btn-outline" onClick={changePassword}>Update password</button>
        </section>

        {/* ── Team Members (admin only) ── */}
        {true && (
          <section className="settings-section">
            <div className="section-header">
              <h2><Users size={14} style={{display:"inline",verticalAlign:"middle",marginRight:6}}/>Team Members</h2>
              <button className="btn-primary" onClick={()=>setShowAddUser(!showAddUser)} style={{fontSize:11,padding:"6px 12px"}}>
                <Plus size={13}/>{showAddUser ? "Cancel" : "Add user"}
              </button>
            </div>

            {showAddUser && (
              <div className="add-user-form">
                <div className="form-grid-2">
                  <Field label="Full name"><input value={newUser.name} onChange={e=>setNewUser(u=>({...u,name:e.target.value}))} placeholder="Full name"/></Field>
                  <Field label="Username"><input value={newUser.username} onChange={e=>setNewUser(u=>({...u,username:e.target.value.toLowerCase()}))} placeholder="username"/></Field>
                  <Field label="Email"><input type="email" value={newUser.email} onChange={e=>setNewUser(u=>({...u,email:e.target.value}))} placeholder="email@example.com"/></Field>
                  <Field label="Password"><input type="password" value={newUser.password} onChange={e=>setNewUser(u=>({...u,password:e.target.value}))} placeholder="Min 6 characters"/></Field>
                  <Field label="Role">
                    <select value={newUser.role} onChange={e=>setNewUser(u=>({...u,role:e.target.value}))} style={{height:36,border:"1px solid #dfe2e6",borderRadius:6,padding:"0 10px",fontSize:12,outline:"none"}}>
                      <option value="Member">Member</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </Field>
                </div>
                {userErr && <div className="settings-error" style={{marginTop:8}}>{userErr}</div>}
                <button className="btn-primary" onClick={addUser} style={{marginTop:10}}><Check size={14}/>Create user</button>
              </div>
            )}

            <div className="users-list">
              {managedUsers.length === 0 && <p className="muted" style={{fontSize:12,padding:"8px 0"}}>No team members yet.</p>}
              {managedUsers.map(u => (
                <div className="user-row" key={u.username}>
                  <div className="user-row-avatar">{u.name.slice(0,2).toUpperCase()}</div>
                  <div className="user-row-info">
                    <strong>{u.name}</strong>
                    <small>@{u.username} · {u.email || "No email"}</small>
                  </div>
                  <span className={`role-badge ${u.role.toLowerCase()}`}>{u.role}</span>
                  <button className="icon-btn-sm danger" onClick={()=>deleteUser(u.username)} title="Delete user"><Trash2 size={13}/></button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Danger zone ── */}
        <section className="settings-section danger-zone">
          <div className="section-header">
            <h2>Danger zone</h2>
            <span className="section-sub">Irreversible actions</span>
          </div>
          <p>Clear all locally stored data including clients, metrics, and custom statuses. This cannot be undone.</p>
          <div className="danger-actions">
            <button className="btn-danger" onClick={()=>{if(confirm("Clear all local data?")){localStorage.clear();window.location.reload();}}}><Trash2 size={15}/>Clear local data</button>
            <button className="btn-ghost" onClick={logout}><LogOut size={15}/>Sign out</button>
          </div>
        </section>

        {error&&<div className="settings-error">{error}</div>}
        {saveMsg&&<div className="settings-success">{saveMsg}</div>}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="form-field"><span className="form-label">{label}</span>{children}</div>);
}
