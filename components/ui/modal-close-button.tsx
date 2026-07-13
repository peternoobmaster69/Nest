import { ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";

type ModalCloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  label?: string;
};

export function ModalCloseButton({
  className = "",
  label = "Close dialog",
  ...props
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      className={`modal-close ${className}`.trim()}
      aria-label={label}
      {...props}
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
}
