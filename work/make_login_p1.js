const fs = require("fs");

let part1 = `"use client";

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
    const isDark = localStorage.getItem("rwaq-dark") === "1";
    setDarkMode(isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, []);

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
`;

fs.writeFileSync("work/login_part1.txt", part1, "utf8");
