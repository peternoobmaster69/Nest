"use client";

import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ConfirmDialogOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

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
    });

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      {dialog.open && typeof document !== "undefined"
        ? createPortal(
            <div className="profile-modal-overlay" onClick={() => closeDialog(false)}>
              <div
                className="profile-modal confirm-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
              >
                <div className="profile-modal-head">
                  <h3 id="confirm-dialog-title">{dialog.title}</h3>
                  <button className="profile-modal-close" onClick={() => closeDialog(false)} aria-label="Close confirmation dialog">
                    Close
                  </button>
                </div>
                <div className="profile-modal-body">
                  <p className="confirm-dialog-copy">{dialog.message}</p>
                  <div className="confirm-dialog-actions">
                    <button className="btn btn-ghost" onClick={() => closeDialog(false)}>
                      {dialog.cancelLabel}
                    </button>
                    <button className="btn btn-primary" onClick={() => closeDialog(true)}>
                      {dialog.confirmLabel}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  return useContext(ConfirmDialogContext);
}
