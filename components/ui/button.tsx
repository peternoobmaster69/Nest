import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconOnly?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className = "",
    variant,
    size = "md",
    loading = false,
    iconOnly = false,
    disabled,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  // Existing feature classes remain authoritative while screens migrate. New
  // actions opt into the token-backed variants explicitly.
  const primitiveClasses = variant ? `btn btn-${variant} btn-${size}` : "";
  return (
    <button
      ref={ref}
      type={type}
      className={`${primitiveClasses}${iconOnly ? " btn-icon" : ""}${loading ? " is-loading" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  );
});
