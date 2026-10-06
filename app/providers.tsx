"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { ReactNode, useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { CollaborationBanner } from "@/components/collaboration-banner";
import { NavigationLoader } from "@/components/navigation-loader";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { notifyToast, ToastProvider } from "@/components/toast-provider";
import { MobileWorkflowManager } from "@/components/mobile-workflow-manager";
import { DeviceIntegration } from "@/components/device-integration";
import { mutationFailureMessage } from "@/lib/api/client";
import { PrivacyConsentProvider } from "@/components/privacy-consent";

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(
    () => {
      const client = new QueryClient({
        mutationCache: new MutationCache({
          onError: (error) => notifyToast(mutationFailureMessage(error), "error"),
          onSuccess: (_data, _variables, _context, mutation) => {
            const successMessage = mutation.meta?.successMessage;
            if (typeof successMessage === "string" && successMessage.trim()) {
              notifyToast(successMessage, "success");
            }
          },
        }),
        queryCache: new QueryCache({
          onError: (_error, query) => {
            if (query.state.data !== undefined) {
              notifyToast("Could not refresh. Showing the last available data.", "error");
            }
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
    <PrivacyConsentProvider>
    <SessionProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ConfirmDialogProvider>
            <ToastProvider>
              <MobileWorkflowManager />
              <DeviceIntegration />
              {children}
              <NavigationLoader />
              <CollaborationBanner />
            </ToastProvider>
          </ConfirmDialogProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
    </PrivacyConsentProvider>
  );
}
