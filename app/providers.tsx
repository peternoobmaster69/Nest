"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { ReactNode, useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { CollaborationBanner } from "@/components/collaboration-banner";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { NavigationLoader } from "@/components/navigation-loader";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { ModalViewportManager } from "@/components/modal-viewport-manager";
import { notifyToast, ToastProvider } from "@/components/toast-provider";
import { MobileWorkflowManager } from "@/components/mobile-workflow-manager";
import { DeviceIntegration } from "@/components/device-integration";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => {
      const client = new QueryClient({
        mutationCache: new MutationCache({
          onError: (error) => {
            notifyToast(error instanceof Error ? error.message : "The action could not be completed.", "error");
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      });

      client.setQueryDefaults(["app-context"], {
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
      });

      client.setQueryDefaults(["dashboard-summary"], {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
      });

      return client;
    },
  );

  return (
    <SessionProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ConfirmDialogProvider>
            <ToastProvider>
              <ModalViewportManager />
              <MobileWorkflowManager />
              <DeviceIntegration />
              {children}
              <NavigationLoader />
              <CollaborationBanner />
              <CookieConsentBanner />
            </ToastProvider>
          </ConfirmDialogProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
