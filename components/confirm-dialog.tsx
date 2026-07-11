"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmOptions, registerConfirmHandler } from "@/lib/confirm-destructive";

type ConfirmDialogOptions = ConfirmOptions;

type ConfirmDialogContextValue = {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
};

const ConfirmDialogContext = createContext<ConfirmDialogContextValue>({
  confirm: async () => false,
});

type ConfirmDialogState = ConfirmDialogOptions & {
  open: boolean;
};

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    message: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    destructive: false,
  });
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const closeDialog = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setDialog((current) => ({ ...current, open: false }));
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    setDialog({
      open: true,
      title: options.title ?? "Confirm Action",
      message: options.message,
      confirmLabel: options.confirmLabel ?? "Confirm",
      cancelLabel: options.cancelLabel ?? "Cancel",
      destructive: options.destructive ?? false,
    });

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  useEffect(() => {
    registerConfirmHandler(confirm);
    return () => registerConfirmHandler(null);
  }, [confirm]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      <Dialog
        open={dialog.open}
        onClose={() => closeDialog(false)}
        title={dialog.title || "Confirm action"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => closeDialog(false)}>{dialog.cancelLabel}</Button>
            <Button variant={dialog.destructive ? "destructive" : "primary"} onClick={() => closeDialog(true)} autoFocus>
              {dialog.confirmLabel}
            </Button>
          </>
        }
      >
        <p className="confirm-dialog-message">{dialog.message}</p>
      </Dialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  return useContext(ConfirmDialogContext);
}
