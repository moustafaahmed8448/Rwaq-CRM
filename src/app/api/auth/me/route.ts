import { NextRequest, NextResponse } from "next/server";
export function GET(request: NextRequest) { if (request.cookies.get("rwaq_session")?.value !== "rwaq-demo-session") return NextResponse.json({ authenticated: false }, { status: 401 }); return NextResponse.json({ authenticated: true, user: { name: "Amira Mansour", initials: "AM", role: "Admin" } }); }
