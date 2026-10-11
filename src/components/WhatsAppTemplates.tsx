"use client";

/**
 * Prefilled WhatsApp message templates.
 *
 * The plain WhatsApp button (ContactButtons) opens the chat with an EMPTY
 * compose box, so the rep retypes the same greeting dozens of times a day. This
 * offers a few ready messages with the client's name (and, where useful, the
 * project) already filled in, for both Arabic and English, and opens
 * `wa.me/<digits>?text=...` so the text is pre-typed.
 *
 * Purely client-side: it only builds a wa.me URL, so there is no backend and no
 * message is sent from here — WhatsApp itself does the sending. Language is read
 * from the shared i18n so the template text matches the UI the rep is using.
 */
import { useMemo, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { phoneDigits } from "@/lib/format";
import { useLang } from "@/lib/i18n";

type TemplateId = "greeting" | "followUp" | "meeting" | "thanks";

/** The templates, in the order they are offered. `ar`/`en` carry {name}/{project}. */
const TEMPLATES: Record<TemplateId, { labelKey: string; ar: string; en: string }> = {
  greeting: {
    labelKey: "wa.template.greeting",
    ar: "مرحباً {name}، معك فريق روق. يسعدنا مساعدتك في {project}. كيف حالنا؟",
    en: "Hi {name}, this is the Rwaq team. We'd love to help you with {project}. How are things going?",
  },
  followUp: {
    labelKey: "wa.template.followUp",
    ar: "مرحباً {name}، أتابع معك بخصوص {project}. هل لديك أي أسئلة يمكنني الإجابة عنها؟",
    en: "Hi {name}, following up on {project}. Any questions I can answer for you?",
  },
  meeting: {
    labelKey: "wa.template.meeting",
    ar: "مرحباً {name}، هل يناسبك تحديد موعد لزيارة {project} هذا الأسبوع؟",
    en: "Hi {name}, would you like to book a visit to {project} this week?",
  },
  thanks: {
    labelKey: "wa.template.thanks",
    ar: "شكراً لك {name} على ثقتك في {project}. نحن هنا لأي استفسار.",
    en: "Thank you {name} for your trust in {project}. We're here for anything you need.",
  },
};

const ORDER: TemplateId[] = ["greeting", "followUp", "meeting", "thanks"];

export default function WhatsAppTemplates({
  phone,
  name,
  project,
  t,
}: {
  phone?: string | null;
  name: string;
  project?: string;
  t: (key: string) => string;
}) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const digits = phoneDigits(phone);

  const fill = (text: string): string =>
    text
      .replace(/\{name\}/g, name || "")
      .replace(/\{project\}/g, (project && project.trim()) || t("form.project"));

  const links = useMemo(() => {
    if (!digits) return [] as Array<{ id: TemplateId; label: string; href: string }>;
    return ORDER.map((id) => {
      const tpl = TEMPLATES[id];
      const body = fill(lang === "ar" ? tpl.ar : tpl.en);
      return {
        id,
        label: t(tpl.labelKey),
        href: `https://wa.me/${digits}?text=${encodeURIComponent(body)}`,
      };
    });
    // `t` and `fill` are stable enough here; the meaningful inputs are digits, name, project, lang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, name, project, lang]);

  if (!digits) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="btn-outline btn-sm"
        title={t("wa.templates")}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <MessageSquarePlus size={13} />
        {t("wa.templates")}
      </button>
    );
  }

  return (
    <span className="wa-templates" onClick={(e) => e.stopPropagation()}>
      <span className="wa-templates-label">{t("wa.templates")}</span>
      {links.map((l) => (
        <a
          key={l.id}
          className="wa-template-link"
          href={l.href}
          target="_blank"
          rel="noreferrer"
          title={l.label}
        >
          {l.label}
        </a>
      ))}
      <button type="button" className="wa-templates-close" onClick={() => setOpen(false)} aria-label={t("common.close")}>
        ×
      </button>
    </span>
  );
}
