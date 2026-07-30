import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { getPushConfiguration } from "@/lib/web-push";

const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(1000), auth: z.string().min(1).max(1000) }),
});

export async function GET() {
  const session = await getDatabaseReadyServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = getPushConfiguration();
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    take: 25,
    select: { id: true, endpoint: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({
    configured: config.configured,
    publicKey: config.publicKey,
    subscribed: subscriptions.length > 0,
    subscriptions: subscriptions.map((subscription) => {
      let provider = "Push service";
      try {
        provider = new URL(subscription.endpoint).hostname;
      } catch {}
      return { id: subscription.id, provider, createdAt: subscription.createdAt, updatedAt: subscription.updatedAt };
    }),
  });
}

export async function POST(request: Request) {
  const session = await getDatabaseReadyServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = SubscriptionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  if (!parsed.data.endpoint.startsWith("https://")) return NextResponse.json({ error: "Push endpoint must use HTTPS" }, { status: 400 });
  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: {
      userId: session.user.id,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      expirationTime: parsed.data.expirationTime == null ? null : BigInt(parsed.data.expirationTime),
    },
    create: {
      userId: session.user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      expirationTime: parsed.data.expirationTime == null ? null : BigInt(parsed.data.expirationTime),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getDatabaseReadyServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { endpoint, subscriptionId } = await request.json().catch(() => ({}));
  if (typeof subscriptionId === "string" && subscriptionId) {
    await prisma.pushSubscription.deleteMany({ where: { id: subscriptionId, userId: session.user.id } });
    return NextResponse.json({ ok: true });
  }
  if (typeof endpoint === "string" && endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { userId: session.user.id, endpoint } });
  }
  return NextResponse.json({ ok: true });
}
