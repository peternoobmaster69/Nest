import type { MouseEvent } from "react";

export function closeOnBackdropClick(event: MouseEvent<HTMLElement>, close: () => void) {
  if (event.target === event.currentTarget) close();
}
