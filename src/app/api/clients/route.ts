import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, unauthorized } from "@/lib/auth";
import { readClients } from "@/lib/storage";

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const clients = readClients();
  return NextResponse.json({ clients });
}
