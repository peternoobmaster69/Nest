"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  APP_ICON_COOKIE,
  APP_ICON_VARIANTS,
  appIconAssets,
  parseAppIcon,
  type AppIconId,
} from "@/lib/app-icons";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type Platform = "ios" | "installed" | "browser";

function readCookie(): AppIconId {
  const match = document.cookie.match(new RegExp(`(?:^|; )${APP_ICON_COOKIE}=([^;]*)`));
  return parseAppIcon(match?.[1]);
}

function detectPlatform(): Platform {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (ios) return "ios";
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  return standalone ? "installed" : "browser";
}

function saveChoice(id: AppIconId) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${APP_ICON_COOKIE}=${id}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

/** Swap the tab icon straight away; the server renders the same choice on later loads. */
function applyTabIcon(id: AppIconId) {
  const { favicon, appleTouch } = appIconAssets(id);
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]').forEach((link) => link.remove());
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.type = "image/svg+xml";
  icon.href = favicon;
  document.head.appendChild(icon);
  // Keep the iOS home-screen icon in sync for a later "Add to Home Screen".
  document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]').forEach((link) => {
    link.href = appleTouch;
  });
}

const GUIDANCE: Record<Platform, string> = {
  ios: "Your home screen keeps the icon it was added with. To apply a new one, remove Nest from your home screen, then add it again from Safari.",
  installed: "Your installed app picks up the new icon the next time your browser checks for updates, usually within a day. It may ask you to confirm the change.",
  browser: "The browser tab updates now. If you install Nest, it will use this icon.",
};

export function SettingsAppIcon() {
  const [selected, setSelected] = useState<AppIconId | null>(null);
  const [platform, setPlatform] = useState<Platform>("browser");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSelected(readCookie());
    setPlatform(detectPlatform());
  }, []);

  const choose = (id: AppIconId) => {
    saveChoice(id);
    setSelected(id);
    setSaved(true);
    applyTabIcon(id);
  };

  return (
    <div className="card settings-card-block settings-app-icon-card">
      <div className="settings-item-copy">
        <div className="settings-section-title">App icon</div>
        <div className="settings-section-copy">
          Choose how Nest looks in your browser tab and on this device&apos;s home screen.
        </div>
      </div>

      <div className="settings-app-icon-grid" role="radiogroup" aria-label="App icon">
        {APP_ICON_VARIANTS.map((variant) => {
          const isSelected = selected === variant.id;
          return (
            <Button
              key={variant.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`settings-app-icon-option${isSelected ? " is-selected" : ""}`}
              onClick={() => choose(variant.id)}
            >
              <span className="settings-app-icon-preview">
                <img src={appIconAssets(variant.id).preview} alt="" width={64} height={64} loading="lazy" decoding="async" />
                {isSelected ? <span className="settings-app-icon-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span> : null}
              </span>
              <span className="settings-app-icon-label">{variant.label}</span>
              <span className="settings-app-icon-description">{variant.description}</span>
            </Button>
          );
        })}
      </div>

      <p className="settings-app-icon-note" role="status">
        {saved ? <strong>Saved for this device. </strong> : null}
        {GUIDANCE[platform]}
      </p>
    </div>
  );
}
