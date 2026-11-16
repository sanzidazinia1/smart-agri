// Layout for logged-in pages: sends guests to /login, adds sidebar + top bar.
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/AppShell";

// Checks the login, loads the user's name/email, then wraps the page in AppShell.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Not logged in? Go to the login page.
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Get the latest email and name from the database for the top bar.
  const email = session.user.email ?? "farmer@smartagri.ai";
  const profile = session.user.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, userName: true } })
    : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
      <AppShell email={profile?.email ?? email} userName={profile?.userName ?? null}>
        {children}
      </AppShell>
    </div>
  );
}
