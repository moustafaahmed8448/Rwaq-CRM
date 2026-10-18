import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE, normalizeRole, sessionCookieOptions, sessionCookieValue } from "@/lib/auth";
import { databaseErrorMessage, findUser } from "@/lib/db";
import { ensureUsersBootstrapped } from "@/lib/bootstrap";
import { checkLock, clearFailures, recordFailure } from "@/lib/login-throttle";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!username || !password)
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });

  // Brute-force guard, checked BEFORE any password comparison. The key is the
  // username + client IP, so one account cannot be ground down by repeated
  // guesses from one source. See login-throttle.ts for the multi-instance caveat.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const lockedFor = checkLock(username, ip);
  if (lockedFor > 0) {
    const minutes = Math.max(1, Math.ceil(lockedFor / 60000));
    return NextResponse.json(
      { error: "Too many attempts", retryAfterMinutes: minutes },
      { status: 429, headers: { "Retry-After": String(Math.ceil(lockedFor / 1000)) } },
    );
  }

  try {
    // First run after the JSON -> Postgres cutover: import the legacy users so
    // nobody is locked out even if `prisma db seed` was never run.
    await ensureUsersBootstrapped();

    const user = await findUser(username);
    // Both "no such user" and "wrong password" record a failure and return the
    // SAME message, so the endpoint never reveals whether a username exists.
    if (!user) {
      recordFailure(username, ip);
      return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
    }

    const match = await bcrypt.compare(password, user.hash);
    if (!match) {
      recordFailure(username, ip);
      return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
    }

    clearFailures(username, ip);
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
