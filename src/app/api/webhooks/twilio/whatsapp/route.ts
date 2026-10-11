import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "twilio";
import { findClientByPhone, recordInboundWhatsAppReply } from "@/lib/db";

/**
 * Twilio WhatsApp inbound webhook.
 *
 * Validation is unchanged: 503 when TWILIO_AUTH_TOKEN is not configured, 403
 * when the signature does not verify — those remain the ONLY non-2xx answers,
 * so Twilio never retries a request we rejected ourselves.
 *
 * A verified reply is now PERSISTED instead of merely acknowledged: the sender
 * number is normalised onto a client (live rows first, archived as fallback),
 * a WHATSAPP_REPLY entry is appended to that client's timeline, and the 1st/2nd
 * contact people get a localized `WA_REPLY` notification (see
 * recordInboundWhatsAppReply in src/lib/db.ts).
 *
 * Every post-validation failure still answers 200 with `stored: false`. Twilio
 * retries non-2xx responses up to ten times, and a retry after a PARTIAL write
 * would stack duplicate timeline entries on the client — acking is the
 * idempotency guarantee here, exactly as the previous acknowledge-only route
 * behaved.
 */
export async function POST(request: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return NextResponse.json({ error: "TWILIO_AUTH_TOKEN is not configured" }, { status: 503 });
  const form = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
  if (!validateRequest(token, request.headers.get("x-twilio-signature") || "", request.url, form))
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });

  // Twilio addresses senders as `whatsapp:+2010…`; strip the channel prefix so
  // the rest of the pipeline only ever sees a plain number.
  const from = String(form.From ?? "").replace(/^whatsapp:/i, "").trim();
  const body = String(form.Body ?? "");
  if (!from || !body.trim()) return NextResponse.json({ received: true, matched: false });

  try {
    const client = await findClientByPhone(from);
    if (!client) return NextResponse.json({ received: true, matched: false });
    await recordInboundWhatsAppReply({
      clientId: client.id,
      clientName: client.name,
      firstContactPerson: client.firstContactPerson,
      secondContactPerson: client.secondContactPerson,
      from,
      body,
    });
    return NextResponse.json({ received: true, matched: true, clientId: client.id });
  } catch {
    // Acknowledged but not stored — see the header note on retries.
    return NextResponse.json({ received: true, matched: false, stored: false });
  }
}
