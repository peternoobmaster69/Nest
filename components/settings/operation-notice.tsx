import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { ReauthenticateButton } from "@/components/reauthentication-message";

export type SettingsOperationNoticeData = {
  title: string;
  detail: string | null;
  tone: "success" | "info" | "warning" | "error";
};

export function SettingsOperationNotice({
  notice,
  className = "",
  requiresReauthentication = false,
}: Readonly<{
  notice: SettingsOperationNoticeData | null;
  className?: string;
  requiresReauthentication?: boolean;
}>) {
  if (!notice) return null;
  const NoticeIcon = { success: CheckCircle2, info: Info, warning: CircleAlert, error: CircleAlert }[notice.tone];
  const extraClassName = className ? ` ${className}` : "";
  return (
    <output className={`settings-operation-notice is-${notice.tone}${extraClassName}`} role={notice.tone === "error" ? "alert" : undefined} aria-live="polite">
      <NoticeIcon size={18} aria-hidden="true" />
      <span className="settings-operation-notice-copy">
        <strong>{notice.title}</strong>
        {notice.detail ? <span>{notice.detail}</span> : null}
      </span>
      {requiresReauthentication ? <ReauthenticateButton /> : null}
    </output>
  );
}
