"use client";

import { CheckCircle2, Send } from "lucide-react";
import { type SubmitEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/controls";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form-field";
import {
  CONTACT_MESSAGE_MAX_LENGTH,
  CONTACT_TOPIC_LABELS,
  CONTACT_TOPICS,
} from "@/lib/domains/contact/topics";
import type { ContactRequest } from "@/lib/domains/contact/contracts";

type FieldErrors = Partial<Record<"name" | "email" | "topic" | "message", string>>;
type Status = "idle" | "sending" | "sent";

const CONTACT_HASH = "#contact";

/**
 * "Contact me" popup for the public landing page. Any element with
 * `data-contact-open` (or a link to #contact) opens it, so the server-rendered
 * page needs no client wrappers around its buttons.
 */
export function LandingContact() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", topic: "general" as ContactRequest["topic"], message: "", website: "" });
  const openedAt = useRef(0);

  const show = useCallback(() => {
    openedAt.current = Date.now();
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (window.location.hash === CONTACT_HASH) {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    // Start fresh next time once a message was sent; keep a half-written draft otherwise.
    if (status === "sent") {
      setForm({ name: "", email: "", topic: "general", message: "", website: "" });
      setStatus("idle");
    }
  }, [status]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const trigger = (event.target as Element | null)?.closest?.("[data-contact-open], a[href='#contact']");
      if (!trigger) return;
      event.preventDefault();
      show();
    };
    const onHash = () => {
      if (window.location.hash === CONTACT_HASH) show();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHash);
    };
  }, [show]);

  const update = (field: keyof typeof form) => (event: { target: { value: string } }) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    if (field in errors) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validate = async (): Promise<FieldErrors> => {
    const { ContactRequestSchema } = await import("@/lib/domains/contact/contracts");
    const next: FieldErrors = {};
    const result = ContactRequestSchema.safeParse(form);
    if (result.success) return next;
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (field === "name" || field === "email" || field === "topic" || field === "message") next[field] ??= issue.message;
    }
    return next;
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setStatus("sending");
    try {
      const nextErrors = await validate();
      setErrors(nextErrors);
      if (Object.values(nextErrors).some(Boolean)) {
        setStatus("idle");
        return;
      }
      const response = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, elapsedMs: Date.now() - openedAt.current }),
      });
      if (response.ok) {
        setStatus("sent");
        return;
      }
      const data = await response.json().catch(() => ({})) as { error?: string; issues?: { fieldErrors?: Record<string, string[]> } };
      const fieldErrors = data.issues?.fieldErrors;
      if (fieldErrors) {
        setErrors({
          name: fieldErrors.name?.[0],
          email: fieldErrors.email?.[0],
          topic: fieldErrors.topic?.[0],
          message: fieldErrors.message?.[0],
        });
      }
      let message = data.error || "Your message couldn't be sent. Please try again.";
      if (fieldErrors) message = "Please check the highlighted fields.";
      if (response.status === 429) message = "You've sent a few messages already. Please try again a little later.";
      setFormError(message);
      setStatus("idle");
    } catch {
      setFormError("You appear to be offline. Check your connection and try again.");
      setStatus("idle");
    }
  };

  let body: ReactNode;
  if (status === "sent") {
    body = (
      <div className="lp-contact-sent">
        <span className="lp-contact-sent-icon"><CheckCircle2 size={28} aria-hidden="true" /></span>
        <h3>Thanks, {form.name.trim().split(/\s+/)[0]}!</h3>
        <output>Your message is on its way. I&apos;ll reply to <strong>{form.email.trim()}</strong> as soon as I can.</output>
        <Button type="button" variant="secondary" onClick={close}>Close</Button>
      </div>
    );
  } else {
    body = (
      <form className="lp-contact-form" onSubmit={submit} noValidate>
        <div className="lp-contact-row">
          <TextField label="Name" name="name" autoComplete="name" required maxLength={120} value={form.name} onChange={update("name")} error={errors.name} disabled={status === "sending"} />
          <TextField label="Email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} value={form.email} onChange={update("email")} error={errors.email} disabled={status === "sending"} />
        </div>
        <SelectField label="Topic" name="topic" value={form.topic} onChange={update("topic")} error={errors.topic} disabled={status === "sending"}>
          {CONTACT_TOPICS.map((topic) => <option key={topic} value={topic}>{CONTACT_TOPIC_LABELS[topic]}</option>)}
        </SelectField>
        <TextAreaField
          label="Message"
          name="message"
          required
          rows={5}
          maxLength={CONTACT_MESSAGE_MAX_LENGTH}
          value={form.message}
          disabled={status === "sending"}
          onChange={update("message")}
          error={errors.message}
          hint={`${form.message.length}/${CONTACT_MESSAGE_MAX_LENGTH}`}
        />
        {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
        <div className="lp-contact-trap" aria-hidden="true">
          <label htmlFor="lp-contact-website">Website</label>
          <Input id="lp-contact-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={update("website")} disabled={status === "sending"} />
        </div>
        {formError ? <p className="lp-contact-error" role="alert">{formError}</p> : null}
        <div className="lp-contact-actions">
          <small>Your details are only used to reply to you.</small>
          <Button type="submit" className="lp-btn-primary" disabled={status === "sending"} aria-busy={status === "sending"}>
            {status === "sending" ? "Sending…" : <>Send message <Send size={15} aria-hidden="true" /></>}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={status === "sent" ? "Message sent" : "Contact me"}
      description={status === "sent" ? undefined : "Questions, feedback, or help with hosting. I usually reply within a couple of days."}
      contentClassName="lp-contact-dialog"
      closeDisabled={status === "sending"}
    >
      {body}
    </Dialog>
  );
}
