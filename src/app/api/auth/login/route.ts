import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { DEMO_SESSION, SESSION_COOKIE, normalizeRole, sessionCookieOptions, sessionCookieValue } from "@/lib/auth";
import { databaseErrorMessage, findUser } from "@/lib/db";
import { ensureUsersBootstrapped } from "@/lib/bootstrap";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!username || !password)
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });

  // Built-in demo user
  if (username === "amira" && password === "rwaq2026") {
    const response = NextResponse.json({
      user: { name: "Amira Mansour", initials: "AM", role: "Admin" },
    });
    response.cookies.set(SESSION_COOKIE, DEMO_SESSION, sessionCookieOptions);
    return response;
  }

  try {
    // First run after the JSON -> Postgres cutover: import the legacy users so
    // nobody is locked out even if `prisma db seed` was never run.
    await ensureUsersBootstrapped();

    const user = await findUser(username);
    if (!user)
      return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });

    const match = await bcrypt.compare(password, user.hash);
    if (!match)
      return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });

    const response = NextResponse.json({
      user: {
        name: user.name,
        initials: user.name.slice(0, 2).toUpperCase(),
        role: normalizeRole(user.role, user.username),
      },
    });
    response.cookies.set(SESSION_COOKIE, sessionCookieValue(user.username), sessionCookieOptions);
    return response;
  } catch (error) {
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
