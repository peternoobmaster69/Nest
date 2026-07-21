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
  } catch {
    throw new Error("Unable to load push subscriptions.");
  }
  let sent = 0;
  let failed = 0;

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
        failed += 1;
        console.warn("Web push delivery failed", { statusCode: statusCode ?? "unknown" });
      }
    }
  }));

  return { sent, failed, attempted: subscriptions.length, configured: true };
}
