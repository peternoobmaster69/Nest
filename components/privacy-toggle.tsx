"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { togglePrivacyMode, usePrivacyMode } from "@/lib/privacy-mode";

/** Top-bar switch that hides or shows balances and amounts everywhere, like the theme toggle. */
export function PrivacyToggle() {
  const hidden = usePrivacyMode();
  return (
    <Button
      type="button"
      className={`privacy-toggle${hidden ? " is-on" : ""}`}
      onClick={togglePrivacyMode}
      aria-pressed={hidden}
      aria-label={hidden ? "Show amounts" : "Hide amounts"}
      title={hidden ? "Show amounts" : "Hide amounts"}
    >
      {hidden ? <EyeOff size={19} strokeWidth={1.8} aria-hidden="true" /> : <Eye size={19} strokeWidth={1.8} aria-hidden="true" />}
    </Button>
  );
}
