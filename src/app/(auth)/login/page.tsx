// Login page: shows the sign-in form (logged-in users go to dashboard).
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "./LoginForm";

// Server page that wraps the login form in the shared auth card.
export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your account."
      footer={
        <>
          New to SmartAgri?{" "}
          <Link href="/register" className="font-bold text-emerald-600 hover:underline dark:text-emerald-400">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
