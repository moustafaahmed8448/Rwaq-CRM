"use client";

import { useEffect, useState } from "react";
import { dateLocale } from "@/lib/format";

export type TimeFormat = "locale" | "12h" | "24h";
const STORAGE_KEY = "rwaq-time-format";
const EVENT_NAME = "rwaq-time-format-changed";

function readTimeFormat(): TimeFormat {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "12h" || value === "24h" ? value : "locale";
  } catch {
    return "locale";
  }
}

export function useTimeFormat(): [TimeFormat, (value: TimeFormat) => void] {
  const [format, setFormat] = useState<TimeFormat>("locale");
  useEffect(() => {
    const refresh = () => setFormat(readTimeFormat());
    refresh();
    window.addEventListener(EVENT_NAME, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT_NAME, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const saveFormat = (value: TimeFormat) => {
    try {
      if (value === "locale") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, value);
      setFormat(value);
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch (error) {
      console.error("Could not save time format preference", error);
    }
  };
  return [format, saveFormat];
}

export function formatDateTime(value: Date | string, lang: string, format: TimeFormat): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(dateLocale(lang), {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    ...(format === "12h" ? { hour12: true } : format === "24h" ? { hour12: false } : {}),
  });
}
