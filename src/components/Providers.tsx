"use client";

// Wraps the app with login session, data fetching and popup message providers
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "swr";
import { FeedbackProvider } from "@/components/Feedback";

// App-wide providers used by the root layout
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SWRConfig
        value={{
          // Default SWR fetcher: get JSON from a URL, throw if the request fails
          fetcher: (url: string) =>
            fetch(url).then((r) => {
              if (!r.ok) throw new Error("Request failed");
              return r.json();
            }),
          // Don't refetch data every time the browser tab regains focus
          revalidateOnFocus: false,
        }}
      >
        <FeedbackProvider>{children}</FeedbackProvider>
      </SWRConfig>
    </SessionProvider>
  );
}
