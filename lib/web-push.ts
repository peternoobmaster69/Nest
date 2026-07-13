import webPush from "web-push";
import { prisma } from "@/lib/prisma";

export type PushPayload = {
  title: string;
  message: string;
  href?: string;
  tag?: string;
};

export function getPushConfiguration() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  return { publicKey, privateKey, subject, configured: Boolean(publicKey && privateKey) };
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const config = getPushConfiguration();
  if (!config.configured) return { sent: 0, configured: false };
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  let subscriptions;
  try {
    subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  } catch (error) {
    console.error("Unable to load push subscriptions", error);
    return { sent: 0, configured: true };
  }
  let sent = 0;

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload), { TTL: 60 * 60 });
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
      } else {
        console.error("Web push delivery failed", error);
      }
    }
  }));

  return { sent, configured: true };
}

export async function sendReceivableDatePushReminders(now = new Date()) {
  const through = new Date(now);
  through.setUTCDate(through.getUTCDate() + 1);
  through.setUTCHours(23, 59, 59, 999);
  const receivables = await prisma.receivable.findMany({
    where: { status: { in: ["OPEN", "PARTIAL"] }, date: { lte: through } },
    select: {
      id: true,
      title: true,
      date: true,
      workspace: { select: { members: { select: { userId: true } } } },
    },
  });
  let sent = 0;
  for (const receivable of receivables) {
    const due = receivable.date.toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "UTC" });
    for (const member of receivable.workspace.members) {
      const result = await sendPushToUser(member.userId, {
        title: "Receivable date reminder",
        message: `${receivable.title} is dated ${due}.`,
        href: "/receivables",
        tag: `receivable-date:${receivable.id}`,
      });
      sent += result.sent;
    }
  }
  return sent;
}
