// Checks that an API request comes from a logged-in user
import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Returns the logged-in user's id, or a 401 "Unauthorized" response to return
export async function requireUser(): Promise<string | NextResponse> {
  let session;
  try {
    session = await auth();
  } catch (error) {
    // No request (e.g. called at build time) counts as not logged in
    if (
      error instanceof Error &&
      error.message.includes("outside a request scope")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session.user.id;
}
