// API /api/auth/register: sign up a new user (login itself is done by Auth.js)
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { defaultIrrigation } from "@/lib/defaults";

// Validation schema: what a sign-up form must send
const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  // Same rule as changing the password in Settings.
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  userName: z.string().trim().max(100).optional(),
});

// POST: create a user with a hashed password and default watering settings
export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Validate the form data before touching the database
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { email, password, userName } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    // Stop if this email is already registered
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    // Never store the plain password, only its salted hash
    const { passwordHash, passwordSalt } = hashPassword(password);

    // DB write: create the user plus their default irrigation config
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        passwordSalt,
        userName: userName || normalizedEmail.split("@")[0],
        irrigationConfig: {
          create: {
            thresholdPercent: defaultIrrigation.threshold,
            manualOverride: defaultIrrigation.manualOverride,
            currentStatus: defaultIrrigation.status,
          },
        },
      },
      select: { id: true, email: true, userName: true },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Failed to register" },
      { status: 500 },
    );
  }
}
