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
  const NoticeIcon = notice.tone === "success" ? CheckCircle2 : notice.tone === "info" ? Info : CircleAlert;
  return (
    <div className={`settings-operation-notice is-${notice.tone}${className ? ` ${className}` : ""}`} role={notice.tone === "error" ? "alert" : "status"} aria-live="polite">
      <NoticeIcon size={18} aria-hidden="true" />
      <div className="settings-operation-notice-copy">
        <strong>{notice.title}</strong>
        {notice.detail ? <span>{notice.detail}</span> : null}
      </div>
      {requiresReauthentication ? <ReauthenticateButton /> : null}
    </div>
  );
}
