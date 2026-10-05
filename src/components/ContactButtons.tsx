"use client";

/**
 * Call + WhatsApp buttons for a stored phone number.
 *
 * Numbers carry spaces/dashes/a leading `+`; the links need plain digits
 * (see phoneDigits in lib/format). Rendered as small icon buttons so they
 * fit in table cells, the linked-clients rows and the detail panel alike.
 */
import { MessageCircle, Phone } from "lucide-react";
import { telHref, whatsAppHref } from "@/lib/format";

export default function ContactButtons({
  phone,
  t,
  compact,
}: {
  phone?: string | null;
  t: (key: string) => string;
  compact?: boolean;
}) {
  const tel = telHref(phone);
  const wa = whatsAppHref(phone);
  if (!tel && !wa) return null;
  return (
    <span className={`contact-buttons${compact ? " is-compact" : ""}`}>
      {tel && (
        <a className="icon-btn-sm" href={tel} title={t("common.call")} onClick={(e) => e.stopPropagation()}>
          <Phone size={13} />
        </a>
      )}
      {wa && (
        <a
          className="icon-btn-sm"
          href={wa}
          target="_blank"
          rel="noreferrer"
          title={t("common.whatsApp")}
          onClick={(e) => e.stopPropagation()}
        >
          <MessageCircle size={13} />
        </a>
      )}
    </span>
  );
}
