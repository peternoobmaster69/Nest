"use client";

type NotesInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  minHeight?: number;
  className?: string;
};

export function MarkdownEditor({
  label,
  value,
  onChange,
  placeholder = "Add notes...",
  rows = 6,
  minHeight = 120,
  className,
}: NotesInputProps) {
  return (
    <label className={className} style={{ display: "grid", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
      <span>{label}</span>
      <textarea
        className="input"
        style={{
          minHeight,
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          lineHeight: "1.5",
          resize: "vertical",
        }}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
