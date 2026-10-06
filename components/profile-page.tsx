"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SubmitEvent, useState } from "react";
import { ArrowRight, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useWorkspaceId } from "@/components/workspace-provider";
import { buildWorkspacePath } from "@/lib/workspace-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ProfilePage({
  userName,
  userEmail,
  userImage,
}: Readonly<{
  userName: string;
  userEmail?: string;
  userImage?: string | null;
}>) {
  const workspaceId = useWorkspaceId();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(userName);
  const [savedName, setSavedName] = useState(userName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const avatarAlt = savedName || userEmail || "User";

  const saveProfile = async (event: SubmitEvent) => {
    event.preventDefault();
    const nextName = displayName.trim();
    if (!nextName) {
      setIsError(true);
      setMessage("Display name is required.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || payload?.error || "Unable to update your profile.");
      }
      setDisplayName(nextName);
      setSavedName(nextName);
      setMessage("Profile updated.");
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Unable to update your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-page">
      <section className="card profile-page-card" aria-labelledby="profile-details-heading">
        <div className="profile-page-identity">
          {userImage ? (
            <Image src={userImage} alt={avatarAlt} width={64} height={64} className="avatar avatar-image profile-page-avatar" />
          ) : (
            <div className="avatar avatar-green profile-page-avatar">{initials(savedName)}</div>
          )}
          <div>
            <span className="profile-page-eyebrow">Nest account</span>
            <h2 id="profile-details-heading">{savedName}</h2>
            <p>{userEmail || "No email address"}</p>
          </div>
        </div>

        <form className="profile-page-form" onSubmit={saveProfile}>
          <label className="profile-page-field">
            <span><UserRound size={16} aria-hidden="true" /> Display name</span>
            <Input
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={120}
              autoComplete="name"
              required
            />
          </label>
          <div className="profile-page-field">
            <span><Mail size={16} aria-hidden="true" /> Email</span>
            <strong>{userEmail || "No email address"}</strong>
            <small>Your sign-in provider manages this address.</small>
          </div>
          {message ? (
            <div className={`profile-page-message${isError ? " is-error" : ""}`} role={isError ? "alert" : "status"}>
              {message}
            </div>
          ) : null}
          <div className="profile-page-actions">
            <Button
              className="btn btn-primary"
              type="submit"
              disabled={saving || displayName.trim() === savedName}
            >
              {saving ? "Saving..." : "Save profile"}
            </Button>
          </div>
        </form>
      </section>

      <section className="card profile-page-security" aria-labelledby="profile-security-heading">
        <span className="profile-page-security-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
        <div>
          <h2 id="profile-security-heading">Sign-in &amp; security</h2>
          <p>Review passkeys, linked sign-in providers, sessions, privacy choices, integrations, and account data.</p>
        </div>
        <Link className="btn btn-ghost" href={workspaceId ? buildWorkspacePath(workspaceId, "/settings?tab=settings") : "/settings?tab=settings"}>
          Privacy &amp; security <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
