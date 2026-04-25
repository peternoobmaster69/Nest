"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { ReactNode, useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { CollaborationBanner } from "@/components/collaboration-banner";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { NavigationLoader } from "@/components/navigation-loader";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <SessionProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ConfirmDialogProvider>
            {children}
            <NavigationLoader />
            <CollaborationBanner />
            <CookieConsentBanner />
          </ConfirmDialogProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
