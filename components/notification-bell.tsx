"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CreditCard, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { ListEnvelope } from "@/lib/api/contracts";
import { queryKeys } from "@/lib/query-keys";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NotificationResponse = {
  notifications: ListEnvelope<NotificationItem>;
  unreadCount: number;
};

async function fetchNotifications() {
  return apiFetch<NotificationResponse>("/api/notifications", { cache: "no-store" });
}

async function updateNotifications(payload: { notificationId: string } | { markAllRead: true }) {
  await apiFetch<{ ok: true }>("/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short" }).format(new Date(value));
}

export function NotificationBell({ workspaceId }: { workspaceId?: string | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const queryKey = queryKeys.notifications(workspaceId);
  const notificationsQuery = useQuery({
    queryKey,
    queryFn: fetchNotifications,
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const updateMutation = useMutation({
    mutationFn: updateNotifications,
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const data = notificationsQuery.data;
  const unreadCount = data?.unreadCount ?? 0;
  const markReadLocally = (notificationId: string) => {
    queryClient.setQueryData<NotificationResponse>(queryKey, (current) => {
      if (!current) return current;
      const items = current.notifications.items.map((notification) =>
        notification.id === notificationId && !notification.readAt
          ? { ...notification, readAt: new Date().toISOString() }
          : notification,
      );
      return {
        notifications: { ...current.notifications, items },
        unreadCount: Math.max(0, current.unreadCount - 1),
      };
    });
  };

  const markAllRead = () => {
    const readAt = new Date().toISOString();
    queryClient.setQueryData<NotificationResponse>(queryKey, (current) => current
      ? {
          notifications: {
            ...current.notifications,
            items: current.notifications.items.map((notification) => ({
              ...notification,
              readAt: notification.readAt ?? readAt,
            })),
          },
          unreadCount: 0,
        }
      : current);
    updateMutation.mutate({ markAllRead: true });
  };

  return (
    <div className="notification-center" ref={rootRef}>
      <button
        type="button"
        className={`notification-bell${open ? " open" : ""}`}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={19} strokeWidth={1.8} aria-hidden="true" />
        {unreadCount > 0 ? <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
      </button>

      {open ? (
        <section className="notification-popover" role="dialog" aria-label="Notifications">
          <header className="notification-header">
            <div>
              <h2>Notifications</h2>
              <p>{unreadCount ? `${unreadCount} unread` : "You’re up to date"}</p>
            </div>
            {unreadCount > 0 ? (
              <button type="button" className="notification-mark-all" onClick={markAllRead} disabled={updateMutation.isPending}>
                <Check size={14} aria-hidden="true" /> Mark all read
              </button>
            ) : null}
          </header>

          <div className="notification-list">
            {notificationsQuery.isLoading ? (
              <div className="notification-state" role="status">
                <LoaderCircle className="notification-spinner" size={22} aria-hidden="true" />
                <span>Loading notifications…</span>
              </div>
            ) : notificationsQuery.isError ? (
              <div className="notification-state notification-state-error">
                <span>Notifications couldn’t be loaded.</span>
                <button type="button" onClick={() => notificationsQuery.refetch()}>Try again</button>
              </div>
            ) : data?.notifications.items.length ? (
              data.notifications.items.map((notification) => {
                const content = (
                  <>
                    <span className="notification-icon" aria-hidden="true"><CreditCard size={17} /></span>
                    <span className="notification-copy">
                      <span className="notification-title-row">
                        <strong>{notification.title}</strong>
                        {!notification.readAt ? <span className="notification-unread-dot" aria-label="Unread" /> : null}
                      </span>
                      <span className="notification-message">{notification.message}</span>
                      <span className="notification-time">{relativeTime(notification.updatedAt)}</span>
                    </span>
                  </>
                );
                const onOpen = () => {
                  if (!notification.readAt) {
                    markReadLocally(notification.id);
                    updateMutation.mutate({ notificationId: notification.id });
                  }
                  setOpen(false);
                };

                return notification.href ? (
                  <Link
                    key={notification.id}
                    href={notification.href}
                    prefetch={false}
                    className={`notification-item${notification.readAt ? "" : " unread"}`}
                    onClick={onOpen}
                  >
                    {content}
                  </Link>
                ) : (
                  <button key={notification.id} type="button" className={`notification-item${notification.readAt ? "" : " unread"}`} onClick={onOpen}>
                    {content}
                  </button>
                );
              })
            ) : (
              <div className="notification-state notification-empty">
                <span className="notification-empty-icon"><Bell size={22} aria-hidden="true" /></span>
                <strong>All caught up</strong>
                <span>Credit card due reminders and workspace invitations will appear here.</span>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
