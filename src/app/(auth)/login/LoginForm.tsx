"use client";
// Login form: checks email + password and opens the dashboard on success.

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Mail } from "lucide-react";
import { AuthError, AuthField, AuthSubmit } from "@/components/AuthFields";

// The email/password form shown on the login page.
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Sends the details to NextAuth; shows an error if they are wrong.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { email: email.trim(), password, redirect: false });
    if (res?.error) {
      setLoading(false);
      setError("That email and password don't match. Check them and try again.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <AuthError message={error} />
      <AuthField label="Email" icon={Mail} type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" autoFocus />
      <AuthField label="Password" icon={KeyRound} type="password" value={password} onChange={setPassword} placeholder="Your password" autoComplete="current-password" />
      <AuthSubmit loading={loading} label="Sign in" loadingLabel="Signing in…" />
    </form>
  );
}
