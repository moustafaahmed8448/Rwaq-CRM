"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, UserRound, LockKeyhole, BadgeCheck, Mail } from "lucide-react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, username, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Signup failed");
      setBusy(false);
      return;
    }
    router.replace("/");
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span>R</span>
          <div><strong>rwaq</strong><small>growth workspace</small></div>
        </div>
        <div className="login-copy">
          <div className="eyebrow"><BadgeCheck size={13} />Create your workspace</div>
          <h1>Join Rwaq.</h1>
          <p>Set up your account and start tracking growth.</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label>
            Full name
            <div className="login-input">
              <UserRound size={16} />
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amira Mansour" />
            </div>
          </label>
          <label>
            Username
            <div className="login-input">
              <UserRound size={16} />
              <input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Choose a username" />
            </div>
          </label>
          <label>
            Password
            <div className="login-input">
              <LockKeyhole size={16} />
              <input required type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
              <button type="button" onClick={() => setShow(!show)} aria-label="Toggle password">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="login-submit" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="login-footer">
          <span>Already have an account?</span>
          <a href="/login" style={{ color: "#7266d7", textDecoration: "none", font: "9px 'DM Mono', monospace" }}>Sign in</a>
        </div>
      </section>
      <aside className="login-aside">
        <div className="login-aside-top"><span>RWQ / 2026</span><span>Weekly intelligence</span></div>
        <div>
          <div className="aside-number">02</div>
          <h2>Start your<br /><em>growth engine</em>.</h2>
          <p>Create an account and take full control of your marketing pipeline.</p>
        </div>
      </aside>
    </main>
  );
}
