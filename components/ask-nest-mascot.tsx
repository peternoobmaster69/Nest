"use client";

import { forwardRef } from "react";
import { Button } from "@/components/ui/button";

export type NestlingMood = "idle" | "thinking" | "news" | "drafting";

const MOUTHS: Record<NestlingMood, string> = {
  idle: "M28.5 34.5Q32 37.5 35.5 34.5",
  drafting: "M28.5 34.5Q32 37.5 35.5 34.5",
  thinking: "M29.5 35.5Q32 35.5 34.5 35.5",
  news: "M27.5 33.5Q32 39 36.5 33.5",
};

/** Nestling: the Nest egg with a face. Purely decorative; the button carries the accessible name. */
export function Nestling({ mood = "idle", size = 44 }: Readonly<{ mood?: NestlingMood; size?: number }>) {
  return (
    <svg className={`nestling is-${mood}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <ellipse className="nestling-shadow" cx="32" cy="59" rx="14" ry="2.6" />
      <g className="nestling-body">
        <path className="nestling-shell" d="M32 6C21 6 12.5 21 11 39C10 53 18 59.5 32 60C46 59.5 54 53 53 39C51.5 21 43 6 32 6Z" />
        <path className="nestling-shine" d="M22 16C19 20 17 25 16.5 30" />
        <g className="nestling-bars">
          <rect x="23" y="44" width="5" height="9" rx="1.5" />
          <rect x="29.5" y="40" width="5" height="13" rx="1.5" />
          <rect x="36" y="36" width="5" height="17" rx="1.5" />
        </g>
        <g className="nestling-eyes">
          <ellipse cx="25" cy="29" rx="2.6" ry="3.2" />
          <ellipse cx="39" cy="29" rx="2.6" ry="3.2" />
        </g>
        <circle className="nestling-cheek" cx="19.5" cy="35" r="2.4" />
        <circle className="nestling-cheek" cx="44.5" cy="35" r="2.4" />
        <path className="nestling-mouth" d={MOUTHS[mood]} />
      </g>
    </svg>
  );
}

type FabProps = {
  mood: NestlingMood;
  status: string;
  onOpen: () => void;
  onDismiss: () => void;
};

/** Floating launcher shown while Ask Nest is minimized, so the conversation is one tap away. */
export const AskNestFab = forwardRef<HTMLButtonElement, FabProps>(function AskNestFab({ mood, status, onOpen, onDismiss }, ref) {
  return (
    <div className={`ask-nest-fab is-${mood}`}>
      <Button ref={ref} type="button" className="ask-nest-fab-button" onClick={onOpen} aria-label={`Reopen Ask Nest. ${status}`}>
        <Nestling mood={mood} size={46} />
        {mood === "news" || mood === "drafting" ? <span className="ask-nest-fab-badge" aria-hidden="true" /> : null}
      </Button>
      <span className="ask-nest-fab-bubble" role="status">{status}</span>
      <Button type="button" className="ask-nest-fab-dismiss" onClick={onDismiss} aria-label="Hide Ask Nest launcher">×</Button>
    </div>
  );
});
