// Adds the user id to NextAuth's session and token types.
import type { DefaultSession } from "next-auth";

// session.user.id is always a string
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

// The JWT token may carry the user id
declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
