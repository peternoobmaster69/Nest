"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type ToastTone = "success" | "error" | "info";
type ToastRecord = { id: number; tone: ToastTone; message: string };
const TOAST_ICONS = { success: CheckCircle2, error: CircleAlert, info: Info };
const externalToastListeners = new Set<(message: string, tone: ToastTone) => void>();

export function notifyToast(message: string, tone: ToastTone = "info") {
  externalToastListeners.forEach((listener) => listener(message, tone));
}
type ToastContextValue = {
  notify: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(() => ({
    notify,
    success: (message) => notify(message, "success"),
    error: (message) => notify(message, "error"),
    info: (message) => notify(message, "info"),
  }), [notify]);

  useEffect(() => {
    const listener = (message: string, tone: ToastTone) => notify(message, tone);
    externalToastListeners.add(listener);
    return () => {
      externalToastListeners.delete(listener);
    };
  }, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => {
          const Icon = TOAST_ICONS[toast.tone];
          return (
            <output key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : undefined}>
              <Icon size={18} aria-hidden="true" />
              <span>{toast.message}</span>
              <Button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
                <X size={15} aria-hidden="true" />
              </Button>
            </output>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
