import type { MouseEvent } from "react";

export function closeOnBackdropDoubleClick(event: MouseEvent<HTMLElement>, close: () => void) {
  if (event.target === event.currentTarget) close();
}
