"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound, ShieldCheck, Sun, Moon, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLang();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDarkMode(localStorage.getItem("rwaq-dark") === "1");
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem("rwaq-dark", next ? "1" : "0");
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError(t("auth.badCredentials"));
        setBusy(false);
        return;
      }
      router.replace("/");
    } catch {
      setError(t("errors.generic"));
      setBusy(false);
    }
  }

  return (
    <main className="login-v2-shell">
      <div className="login-v2-glow login-v2-glow-top" />
      <div className="login-v2-glow login-v2-glow-bottom" />

      <header className="login-v2-topbar">
        <div className="login-v2-brand-badge">
          <span className="brand-letter">R</span>
          <span className="brand-name">rwaq</span>
          <span className="login-v2-pill">{t("auth.secureBadge")}</span>
        </div>
        <div className="login-v2-topbar-actions">
          <div className="lang-switch" dir="ltr" role="group" aria-label={t("settings.language")}>
            <button
              type="button"
              className={lang === "ar" ? "active" : ""}
              aria-pressed={lang === "ar"}
              onClick={() => setLang("ar")}
            >
              العربية
            </button>
            <button
              type="button"
              className={lang === "en" ? "active" : ""}
              aria-pressed={lang === "en"}
              onClick={() => setLang("en")}
            >
              English
            </button>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleDark}
            title={darkMode ? t("header.switchLight") : t("header.switchDark")}
            aria-label={darkMode ? t("header.switchLight") : t("header.switchDark")}
          >
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <div className="login-v2-center">
        <section className="login-v2-card">
          <div className="login-v2-card-header">
            <div className="login-v2-icon-wrap">
              <span className="login-v2-logo">R</span>
            </div>
            <h1>{t("auth.welcomeBack")}</h1>
            <p>{t("auth.signinSub")}</p>
          </div>

          <form className="login-v2-form" onSubmit={submit}>
            <div className="login-v2-field">
              <label htmlFor="login-username">{t("auth.username")}</label>
              <div className="login-v2-input-wrap">
                <UserRound size={17} className="login-v2-input-icon" />
                <input
                  id="login-username"
                  required
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("auth.usernamePh")}
                />
              </div>
            </div>

            <div className="login-v2-field">
              <label htmlFor="login-password">{t("auth.password")}</label>
              <div className="login-v2-input-wrap">
                <LockKeyhole size={17} className="login-v2-input-icon" />
                <input
                  id="login-password"
                  required
                  autoComplete="current-password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPh")}
                />
                <button
                  type="button"
                  className="login-v2-eye-btn"
                  onClick={() => setShow(!show)}
                  aria-label={t("auth.togglePassword")}
                  tabIndex={-1}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="login-v2-error-banner" role="alert">
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="login-v2-submit-btn" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={16} className="login-v2-spinner" />
                  <span>{t("auth.signingIn")}</span>
                </>
              ) : (
                <>
                  <span>{t("auth.signIn")}</span>
                  <ArrowRight size={16} className="login-v2-arrow" />
                </>
              )}
            </button>
          </form>

          <footer className="login-v2-card-footer">
            <div className="login-v2-admin-note">
              <ShieldCheck size={14} />
              <span>{t("auth.contactAdmin")}</span>
            </div>
            <div className="login-v2-copyright">
              <span>{t("auth.brand")}</span>
              <span>© {new Date().getFullYear()}</span>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
