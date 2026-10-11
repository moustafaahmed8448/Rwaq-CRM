import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { databaseErrorMessage, findClientsByPhone } from "@/lib/db";

/**
 * Duplicate-phone check for the add/edit client form.
 *
 * The duplicates panel finds duplicates AFTER they exist and offers a merge;
 * this answers the question at the moment of entry — "this number is already on
 * someone" — so the rep can open that client instead of creating a second row.
 * It is deliberately read-only and returns just enough (id, name, status,
 * archived) to render a warning; it never exposes the whole book.
 *
 * Unlike most client reads this is NOT scoped to the caller's own book: the
 * whole point is to stop a duplicate being created, and a rep who cannot see a
 * colleague's row with the same number would simply save a second copy. Only a
 * handful of identifying fields come back, never notes or contact details.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) return unauthorized();

  const phone = (request.nextUrl.searchParams.get("phone") ?? "").trim();
  const excludeId = (request.nextUrl.searchParams.get("excludeId") ?? "").trim();
  // A very short query is ignored rather than matched, so typing the first digit
  // does not flash a warning over half the book.
  if (phone.replace(/\D/g, "").length < 6) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const matches = await findClientsByPhone(phone, { excludeId, limit: 5 });
    return NextResponse.json({
      matches: matches.map((c) => ({
        id: c.id,
        name: c.name,
        phoneNumber: c.phoneNumber,
        status: c.status,
        archived: c.archived,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
