export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  workspace?: { name: string; role: string };
  details?: Array<{
    label: string;
    value: string;
    tone?: "default" | "positive" | "negative" | "warning";
  }>;
  reversal?: string;
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

export function confirmMoneyChange(options: Omit<ConfirmOptions, "destructive">) {
  if (!activeConfirmHandler) return Promise.resolve(false);
  return activeConfirmHandler({
    ...options,
    title: options.title ?? "Confirm money change",
    confirmLabel: options.confirmLabel ?? "Confirm",
    cancelLabel: options.cancelLabel ?? "Cancel",
    destructive: false,
  });
}
