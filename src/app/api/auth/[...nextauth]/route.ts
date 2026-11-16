// API /api/auth/*: Auth.js login, logout and session routes
import { handlers } from "@/auth";

// GET/POST: hand every auth request to Auth.js (set up in src/auth.ts)
export const { GET, POST } = handlers;
