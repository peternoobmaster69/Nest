export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmHandler = (options: ConfirmOptions) => Promise<boolean>;
let activeConfirmHandler: ConfirmHandler | null = null;

export function registerConfirmHandler(handler: ConfirmHandler | null) {
  activeConfirmHandler = handler;
}

export function confirmDestructiveAction(message: string, title = "Confirm action") {
  if (!activeConfirmHandler) return Promise.resolve(false);
  return activeConfirmHandler({
    title,
    message,
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    destructive: true,
  });
}
