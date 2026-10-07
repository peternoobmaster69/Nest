"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";

type CardTheme = { key: string; label: string; background: string };

export function CardThemePicker({ themes, themeKey, plainColor, bankGradient, onThemeChange, onColorChange }: Readonly<{
  themes: readonly CardTheme[];
  themeKey: string;
  plainColor: string;
  bankGradient: string;
  onThemeChange: (themeKey: string) => void;
  onColorChange: (color: string) => void;
}>) {
  return (
    <fieldset className="form-group cc-span-2 cc-theme-fieldset">
      <legend className="label">Card Theme</legend>
      <div className="cc-theme-grid">
        <div className={`cc-theme-chip${themeKey.startsWith("custom:") ? " on" : ""}`}>
          <Button
            type="button"
            className="cc-theme-select"
            onClick={() => onThemeChange(`custom:${plainColor}`)}
            title="Plain color"
            aria-label="Use plain color"
            aria-pressed={themeKey.startsWith("custom:")}
          >
            <span className="cc-theme-swatch" style={{ background: plainColor }} />
            <span className="cc-theme-label">Plain Color</span>
          </Button>
          <Input
            type="color"
            aria-label="Plain card color"
            value={plainColor}
            className="cc-theme-color"
            onChange={(event) => onColorChange(event.target.value)}
          />
        </div>
        {themes.map((theme) => (
          <Button
            key={theme.key}
            type="button"
            className={`cc-theme-chip${themeKey === theme.key ? " on" : ""}`}
            onClick={() => onThemeChange(theme.key)}
            title={theme.label}
            aria-label={`Use ${theme.label}`}
            aria-pressed={themeKey === theme.key}
          >
            <span className="cc-theme-swatch" style={{ background: theme.key === "bank-default" ? bankGradient : theme.background }} />
            <span className="cc-theme-label">{theme.label}</span>
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
