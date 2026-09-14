import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { demoClients } from "@/lib/demo-data";
import { hasDatabase, prisma } from "@/lib/prisma";
import { isAuthenticated, unauthorized } from "@/lib/auth";

const dateValue = (value: Date | string) => value instanceof Date ? value.toISOString() : value;

export async function POST(request: NextRequest) {
	if (!isAuthenticated(request)) return unauthorized();
	if (!process.env.GOOGLE_SHEETS_SPREADSHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) return NextResponse.json({ error: "Google Sheets credentials are not configured" }, { status: 503 });
	const body = await request.json().catch(() => ({}));
	const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
	const sheets = google.sheets({ version: "v4", auth });
	const clients = hasDatabase() ? await prisma.client.findMany({ orderBy: { createdAt: "asc" } }) : demoClients;
	const salesperson = typeof body.salesperson === "string" && body.salesperson !== "ALL" ? body.salesperson : "";
	const filtered = clients.filter(client => !salesperson || client.firstContactPerson === salesperson || client.secondContactPerson === salesperson);
	const values = [
		["Exported At", "Client ID", "Created Date", "Client Name", "Phone Number", "Status", "Project", "Location", "Acquisition Channel", "Next Operation/Action Needed", "First Person to Contact", "Second Person to Take Action", "Last Update Date"],
		...filtered.map(client => [new Date().toISOString(), client.id, dateValue(client.createdAt), client.name, client.phoneNumber, client.status, client.project, client.location, client.acquisitionChannel, client.operationToTake, client.firstContactPerson, client.secondContactPerson, dateValue(client.lastUpdateDate)]),
	];
	await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID, range: process.env.GOOGLE_SHEETS_REPORT_RANGE || "Reports!A:M", valueInputOption: "USER_ENTERED", requestBody: { values } });
	return NextResponse.json({ status: "succeeded", exportedClients: filtered.length, range: process.env.GOOGLE_SHEETS_REPORT_RANGE || "Reports!A:M" });
}
