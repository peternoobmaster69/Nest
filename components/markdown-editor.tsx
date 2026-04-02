"use client";

import { useId, useMemo, useRef, useState } from "react";

type MarkdownEditorProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  minHeight?: number;
  className?: string;
};

type ToolbarAction = {
  icon: string;
  title: string;
  wrap?: [string, string];
  blockPrefix?: string;
  insert?: string;
};

type ToolbarGroup = {
  label: string;
  actions: ToolbarAction[];
};

const TOOLBAR_GROUPS: ToolbarGroup[] = [
  {
    label: "Text",
    actions: [
      { icon: "H1", title: "Heading", blockPrefix: "# " },
      { icon: "B", title: "Bold", wrap: ["**", "**"] },
      { icon: "I", title: "Italic", wrap: ["*", "*"] },
      { icon: "S", title: "Strike", wrap: ["~~", "~~"] },
    ],
  },
  {
    label: "Lists",
    actions: [
      { icon: "•", title: "Bullet list", blockPrefix: "- " },
      { icon: "1.", title: "Numbered list", blockPrefix: "1. " },
      { icon: '"', title: "Quote", blockPrefix: "> " },
    ],
  },
  {
    label: "Insert",
    actions: [
      { icon: "</>", title: "Code", wrap: ["`", "`"] },
      { icon: "🔗", title: "Link", insert: "[label](https://example.com)" },
    ],
  },
];

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function applyInlineMarkdown(line: string) {
  return line
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

function renderMarkdown(markdown: string) {
  const escaped = escapeHtml(markdown).replace(/\r\n/g, "\n");
  const lines = escaped.split("\n");
  const html: string[] = [];
  let inList = false;
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (inList && listType) html.push(`</${listType}>`);
    inList = false;
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      html.push("<p><br /></p>");
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${applyInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^&gt;\s+(.+)$/);
    if (quoteMatch) {
      closeList();
      html.push(`<blockquote>${applyInlineMarkdown(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const unorderedMatch = line.match(/^- (.+)$/);
    if (unorderedMatch) {
      if (!inList || listType !== "ul") {
        closeList();
        html.push("<ul>");
        inList = true;
        listType = "ul";
      }
      html.push(`<li>${applyInlineMarkdown(unorderedMatch[1])}</li>`);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      if (!inList || listType !== "ol") {
        closeList();
        html.push("<ol>");
        inList = true;
        listType = "ol";
      }
      html.push(`<li>${applyInlineMarkdown(orderedMatch[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${applyInlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("");
}

export function MarkdownEditor({
  label,
  value,
  onChange,
  placeholder = "Write in Markdown",
  rows = 10,
  minHeight = 220,
  className,
}: MarkdownEditorProps) {
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewHtml = useMemo(() => renderMarkdown(value), [value]);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  const applyAction = (action: ToolbarAction) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const selectedText = value.slice(start, end);

    let replacement = selectedText;
    if (action.wrap) {
      replacement = `${action.wrap[0]}${selectedText || "text"}${action.wrap[1]}`;
    } else if (action.blockPrefix) {
      const content = selectedText || "text";
      replacement = content
        .split("\n")
        .map((line) => `${action.blockPrefix}${line || "text"}`)
        .join("\n");
    } else if (action.insert) {
      replacement = action.insert;
    }

    const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    onChange(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + replacement.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <label className={className} style={{ display: "grid", gap: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
      <span>{label}</span>
      <div className="markdown-editor">
        <div className="markdown-toolbar-row">
          <div className="markdown-toolbar-scroll">
            <div className="markdown-toolbar" role="toolbar" aria-label={`${label} formatting tools`}>
              {TOOLBAR_GROUPS.map((group) => (
                <div key={group.label} className="markdown-tool-group" role="group" aria-label={group.label}>
                  {group.actions.map((action) => (
                    <button
                      key={action.title}
                      className="markdown-tool"
                      type="button"
                      title={action.title}
                      aria-label={action.title}
                      onClick={() => applyAction(action)}
                      disabled={mode === "preview"}
                    >
                      {action.icon}
                    </button>
                  ))}
                </div>
              ))}
              <div className="markdown-mode-toggle" role="tablist" aria-label={`${label} view mode`}>
                <button
                  type="button"
                  className={`markdown-mode-btn ${mode === "edit" ? "is-active" : ""}`}
                  onClick={() => setMode("edit")}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`markdown-mode-btn ${mode === "preview" ? "is-active" : ""}`}
                  onClick={() => setMode("preview")}
                >
                  Preview
                </button>
              </div>
            </div>
          </div>
        </div>
        {mode === "edit" ? (
          <textarea
            id={inputId}
            ref={textareaRef}
            className="input markdown-input"
            rows={rows}
            style={{ minHeight }}
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <div className="markdown-preview" style={{ minHeight }} dangerouslySetInnerHTML={{ __html: previewHtml || "<p><em>Preview</em></p>" }} />
        )}
      </div>
    </label>
  );
}
