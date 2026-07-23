import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listInAppNotifications,
  markAllInAppNotificationsRead,
  markInAppNotificationRead,
  syncCreditCardDueNotificationsForUser,
} from "@/lib/in-app-notifications";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { ApiRequestError, parseJsonBody } from "@/lib/api-security";
import { parseListQuery } from "@/lib/api/pagination";

const UpdateNotificationsSchema = z.union([
  z.object({ notificationId: z.string().min(1) }),
  z.object({ markAllRead: z.literal(true) }),
]);

function errorResponse(error: unknown, action: "load" | "update") {
  if (error instanceof ApiAuthError || error instanceof ApiRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ error: `Failed to ${action} notifications`, message }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const query = parseListQuery(request, { defaultLimit: 25, maxLimit: 50 });
    await syncCreditCardDueNotificationsForUser(userId, workspaceId);
    const result = await listInAppNotifications(userId, workspaceId, query);
    return NextResponse.json({
      notifications: result.page,
      unreadCount: result.unreadCount,
    });
  } catch (error) {
    return errorResponse(error, "load");
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const parsed = { data: await parseJsonBody(request, UpdateNotificationsSchema) };

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
