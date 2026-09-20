import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createUser, databaseErrorMessage, findUser } from "@/lib/db";
import { SESSION_COOKIE, sessionCookieOptions, sessionCookieValue } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();

  if (!username || username.length < 2)
    return NextResponse.json({ error: "Username must be at least 2 characters" }, { status: 400 });
  if (!name)
    return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  if (password.length < 6)
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });

  try {
    if (await findUser(username))
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });

    const hash = await bcrypt.hash(password, 10);
    await createUser({
      username,
      name,
      email: String(body.email ?? "").trim() || undefined,
      role: "Member",
      hash,
    });

    const response = NextResponse.json(
      { user: { name, initials: name.slice(0, 2).toUpperCase(), email: body.email ?? "" } },
      { status: 201 },
    );
    response.cookies.set(SESSION_COOKIE, sessionCookieValue(username), sessionCookieOptions);
    return response;
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
