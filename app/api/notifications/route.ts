import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listInAppNotifications,
  markAllInAppNotificationsRead,
  markInAppNotificationRead,
  syncCreditCardDueNotificationsForUser,
} from "@/lib/in-app-notifications";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

const UpdateNotificationsSchema = z.union([
  z.object({ notificationId: z.string().min(1) }),
  z.object({ markAllRead: z.literal(true) }),
]);

function errorResponse(error: unknown, action: "load" | "update") {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ error: `Failed to ${action} notifications`, message }, { status: 500 });
}

export async function GET() {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    await syncCreditCardDueNotificationsForUser(userId, workspaceId);
    const notifications = await listInAppNotifications(userId, workspaceId);
    return NextResponse.json({
      notifications,
      unreadCount: notifications.filter((notification) => !notification.readAt).length,
    });
  } catch (error) {
    return errorResponse(error, "load");
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const parsed = UpdateNotificationsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid notification update" }, { status: 400 });
    }

    if ("markAllRead" in parsed.data) {
      await markAllInAppNotificationsRead(userId, workspaceId);
    } else {
      await markInAppNotificationRead(userId, parsed.data.notificationId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "update");
  }
}
