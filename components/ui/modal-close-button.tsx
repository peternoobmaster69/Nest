import { ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

type ModalCloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  label?: string;
};

export function ModalCloseButton({
  className = "",
  label = "Close dialog",
  ...props
}: ModalCloseButtonProps) {
  return (
    <Button
      className={`modal-close ${className}`.trim()}
      aria-label={label}
      iconOnly
      {...props}
    >
      <X size={18} aria-hidden="true" />
    </Button>
  );
}
