// Login setup (NextAuth): checks email + password and keeps the user in a JWT session.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

// Rules for the login form values
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// Auth helpers used across the app (sign in/out, read the session)
export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // Checks the email and password; returns the user, or null if wrong
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        });
        if (!user) return null;

        const ok = verifyPassword(
          password,
          user.passwordHash,
          user.passwordSalt,
        );
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.userName ?? user.email.split("@")[0],
        };
      },
    }),
  ],
  // Copy the user id into the token, then into the session
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id as string;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
