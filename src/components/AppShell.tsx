"use client";

// Logged-in page layout: sidebar on the left, top bar and page content
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { MOTION, Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

// Browser storage key that remembers if the sidebar is collapsed
const STORAGE_KEY = "smart-agri:sidebar-collapsed";
// Functions to call when the collapsed setting changes
const listeners = new Set<() => void>();

// Listen for collapsed-setting changes (also from other browser tabs)
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// Read the saved collapsed setting from the browser
function readCollapsed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Save the collapsed setting and tell all listeners
function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage unavailable (private mode); the toggle still works for this render.
  }
  listeners.forEach((listener) => listener());
}

/** App chrome: desktop sidebar (collapsible, remembered per browser) + topbar. */
export function AppShell({
  email,
  userName,
  children,
}: {
  email: string;
  userName: string | null;
  children: ReactNode;
}) {
  // Current collapsed state, kept in sync with browser storage
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const shellRef = useRef<HTMLDivElement>(null);

  // Turn on animations only after load so the sidebar doesn't animate closed
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (shellRef.current) shellRef.current.dataset.ready = "true";
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={shellRef} className="group/shell">
      {/* Desktop sidebar (hidden on mobile) */}
      <div
        className={`hidden md:fixed md:inset-y-0 md:z-40 md:flex md:flex-col group-data-[ready]/shell:transition-[width] ${MOTION} ${
          collapsed ? "md:w-[72px]" : "md:w-64"
        }`}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => writeCollapsed(!collapsed)} />
      </div>
      {/* Top bar and page content, pushed right by the sidebar width */}
      <div
        className={`group-data-[ready]/shell:transition-[padding] ${MOTION} ${
          collapsed ? "md:pl-[72px]" : "md:pl-64"
        }`}
      >
        <Topbar email={email} userName={userName} />
        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
