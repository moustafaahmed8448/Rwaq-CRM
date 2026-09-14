import { NextRequest, NextResponse } from "next/server";
export const isAuthenticated = (request: NextRequest) => request.cookies.get("rwaq_session")?.value === "rwaq-demo-session";
export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
